/**
 * Deal & Comms tracker → EcomPulse CRM sync.
 *
 * Pushes each closed-deal row to the CRM's universal inbound endpoint
 * (POST /api/inbound/event with event:"deal"). The CRM finds/creates the lead
 * by name, logs a won deal (Order Value) and — when Status = Paid — a full-value
 * payment (Cash Collected + commissions). Re-syncing a row is safe: the CRM
 * dedupes on a stable per-row id that this script stamps into a hidden column.
 *
 * SETUP (once):
 *   1. Extensions → Apps Script, paste this file, Save.
 *   2. CRM Sync menu → "Set credentials…" (paste endpoint URL + API key).
 *   3. CRM Sync → "Test connection / diagnose" — confirms the key works AND
 *      that the deal sheet is detected. Fix anything it flags before continuing.
 *   4. CRM Sync → "Install auto-sync" and authorize. This installs BOTH an
 *      on-edit trigger (instant) and an hourly backstop (catches non-UI edits).
 *   5. CRM Sync → "Sync all rows" to backfill existing deals.
 *
 * After that, editing any deal row syncs it automatically; the hourly backstop
 * re-syncs everything (idempotent) so updates made by imports/other tools also
 * land even though on-edit only fires for manual edits.
 */

// ── Config ──────────────────────────────────────────────────────────────────
// SHEET_NAME is only a HINT now. The deal sheet is detected by its headers
// ("Lead Name" + "Deal Value"), so a renamed tab no longer breaks auto-sync.
var SHEET_NAME = "Deal Log";
var SYNC_ID_HEADER = "CRM Sync ID"; // hidden column this script manages
var CURRENCY = "USD"; // the sheet logs $ values
var BACKSTOP_MINUTES = 60; // hourly safety-net re-sync (catches non-UI edits)

// Header text in the sheet → payload field. Matching is case-insensitive and
// space-insensitive, so "Offer / Product" and "offer/product" both work.
var FIELD_HEADERS = {
  deal_date: ["date"],
  lead_name: ["lead name", "lead", "name"],
  offer: ["offer / product", "offer/product", "offer", "product"],
  deal_value: ["deal value", "amount", "value"],
  closer: ["closer"],
  setter: ["setter"],
  status: ["status"],
  plan_type: ["plan type", "plan"],
  source: ["source"],
};

// ── Menu ──────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CRM Sync")
    .addItem("Sync all rows (backfill)", "syncAllRows")
    .addItem("Sync current row", "syncCurrentRow")
    .addSeparator()
    .addItem("Install auto-sync", "installAutoSync")
    .addItem("Test connection / diagnose", "diagnose")
    .addItem("Set credentials…", "setupCredentials")
    .addToUi();
}

// ── Credentials ─────────────────────────────────────────────────────────────
function setupCredentials() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var urlResp = ui.prompt(
    "CRM endpoint URL",
    'Paste the inbound endpoint (ends with /api/inbound/event):',
    ui.ButtonSet.OK_CANCEL
  );
  if (urlResp.getSelectedButton() !== ui.Button.OK) return;
  var keyResp = ui.prompt("CRM API key", "Paste the API key (Bearer token):", ui.ButtonSet.OK_CANCEL);
  if (keyResp.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty("CRM_ENDPOINT", urlResp.getResponseText().trim());
  props.setProperty("CRM_API_KEY", keyResp.getResponseText().trim());
  ui.alert("Saved. Run 'Test connection / diagnose' next to confirm it works.");
}

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = props.getProperty("CRM_ENDPOINT");
  var apiKey = props.getProperty("CRM_API_KEY");
  if (!endpoint || !apiKey) {
    throw new Error("Missing credentials — run 'Set credentials…' from the CRM Sync menu first.");
  }
  return { endpoint: endpoint, apiKey: apiKey };
}

// ── Trigger install ─────────────────────────────────────────────────────────
function installAutoSync() {
  var ss = SpreadsheetApp.getActive();
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var fn = existing[i].getHandlerFunction();
    if (fn === "onEditAutoSync" || fn === "backstopSync") ScriptApp.deleteTrigger(existing[i]);
  }
  // Instant: installable on-edit trigger (runs with auth → can call the CRM).
  ScriptApp.newTrigger("onEditAutoSync").forSpreadsheet(ss).onEdit().create();
  // Safety net: time-based re-sync so edits made by imports / the Sheets API /
  // other tools (which do NOT fire onEdit) still reach the CRM. Idempotent.
  ScriptApp.newTrigger("backstopSync").timeBased().everyMinutes(roundTriggerMinutes_(BACKSTOP_MINUTES)).create();

  var ok = countTriggers_();
  SpreadsheetApp.getUi().alert(
    "Auto-sync installed.\n\n• On-edit trigger: " + (ok.onEdit ? "✓" : "✗ FAILED") +
    "\n• Hourly backstop: " + (ok.backstop ? "✓" : "✗ FAILED") +
    "\n\nEdit a deal row to test, then check 'Test connection / diagnose' if nothing appears in the CRM."
  );
}

function countTriggers_() {
  var t = ScriptApp.getProjectTriggers();
  var res = { onEdit: false, backstop: false };
  for (var i = 0; i < t.length; i++) {
    var fn = t[i].getHandlerFunction();
    if (fn === "onEditAutoSync") res.onEdit = true;
    if (fn === "backstopSync") res.backstop = true;
  }
  return res;
}

// everyMinutes only accepts 1,5,10,15,30; map anything else to the nearest hour.
function roundTriggerMinutes_(m) {
  if (m <= 1) return 1;
  if (m <= 5) return 5;
  if (m <= 10) return 10;
  if (m <= 15) return 15;
  return 30;
}

// ── Auto-sync handlers ────────────────────────────────────────────────────────
function onEditAutoSync(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  // Detect the deal sheet by its HEADERS, not its tab name — a renamed tab used
  // to silently break auto-sync. If this sheet has no deal headers, it's some
  // other tab; ignore the edit.
  var ctx;
  try {
    ctx = buildContext_(sheet);
  } catch (err) {
    return;
  }
  var row = e.range.getRow();
  if (row <= ctx.headerRow) return; // header / title rows
  if (e.range.getColumn() === ctx.syncCol) return; // ignore our own stamp

  var res;
  try {
    res = syncRow_(sheet, ctx, row, getConfig_(), true);
  } catch (err) {
    res = { status: "failed", message: String(err && err.message ? err.message : err) };
  }
  // Surface the outcome on the row's sync cell so failures aren't invisible.
  annotateRow_(sheet, ctx, row, res);
}

// Time-based backstop: re-sync every row (idempotent) so edits that don't fire
// onEdit (imports, Sheets API, paste from another sheet) still reach the CRM.
function backstopSync() {
  var sheet = findDealSheet_();
  if (!sheet) return;
  var ctx = buildContext_(sheet);
  var cfg = getConfig_();
  var last = sheet.getLastRow();
  for (var row = ctx.headerRow + 1; row <= last; row++) {
    try {
      var res = syncRow_(sheet, ctx, row, cfg, true);
      annotateRow_(sheet, ctx, row, res);
    } catch (err) {
      // keep going; one bad row shouldn't stop the backstop
    }
  }
}

/** Write a small note on the row's sync cell: clears on success, shows the
 *  error + timestamp on failure, so problems are visible right in the sheet. */
function annotateRow_(sheet, ctx, row, res) {
  try {
    var cell = sheet.getRange(row, ctx.syncCol);
    if (res && (res.status === "ok" || res.status === "skipped")) {
      cell.clearNote();
    } else if (res && res.status === "warn") {
      cell.setNote("CRM sync warning @ " + new Date() + "\n" + res.message);
    } else {
      cell.setNote("CRM sync FAILED @ " + new Date() + "\n" + (res ? res.message : "unknown error"));
    }
  } catch (err) {}
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
function diagnose() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];

  // 1. Credentials
  var cfg = null;
  try {
    cfg = getConfig_();
    lines.push("✓ Credentials set (endpoint + key).");
    lines.push("   endpoint: " + cfg.endpoint);
  } catch (err) {
    lines.push("✗ " + err.message);
  }

  // 2. Deal sheet detection
  var sheet = findDealSheet_();
  if (sheet) {
    var ctx = buildContext_(sheet);
    lines.push('✓ Deal sheet detected: "' + sheet.getName() + '" (header row ' + ctx.headerRow + ").");
    if (SHEET_NAME && sheet.getName() !== SHEET_NAME) {
      lines.push('   ⚠ Tab is "' + sheet.getName() + '", not the configured "' + SHEET_NAME +
        '". Auto-sync still works (detected by headers).');
    }
  } else {
    lines.push('✗ No tab found with "Lead Name" + "Deal Value" headers. Auto-sync cannot run.');
  }

  // 3. Triggers installed
  var t = countTriggers_();
  lines.push((t.onEdit ? "✓" : "✗") + " On-edit trigger " + (t.onEdit ? "installed." : "MISSING — run 'Install auto-sync'."));
  lines.push((t.backstop ? "✓" : "✗") + " Hourly backstop " + (t.backstop ? "installed." : "MISSING — run 'Install auto-sync'."));

  // 4. Live connectivity test (no data created — uses an unrecognised event so
  //    the CRM authenticates the key then rejects the event with a 400).
  if (cfg) {
    try {
      var resp = UrlFetchApp.fetch(cfg.endpoint, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + cfg.apiKey },
        payload: JSON.stringify({ event: "__connection_test__" }),
        muteHttpExceptions: true,
      });
      var code = resp.getResponseCode();
      if (code === 401 || code === 403) {
        lines.push("✗ Connection: API key REJECTED (" + code + "). Re-generate the key in the CRM (needs lead.create + payment.create) and 'Set credentials…' again.");
      } else if (code === 400) {
        lines.push("✓ Connection OK — key accepted, endpoint reachable.");
      } else {
        lines.push("? Connection returned " + code + ": " + resp.getContentText().slice(0, 120));
      }
    } catch (err) {
      lines.push("✗ Connection failed: " + err.message);
    }
  }

  ui.alert("CRM Sync diagnostics\n\n" + lines.join("\n"));
}

// ── Sync entry points ───────────────────────────────────────────────────────
function syncCurrentRow() {
  var sheet = targetSheet_();
  var ctx = buildContext_(sheet);
  var row = sheet.getActiveCell().getRow();
  if (row <= ctx.headerRow) {
    SpreadsheetApp.getActive().toast("Select a deal row first.", "CRM Sync");
    return;
  }
  var res = syncRow_(sheet, ctx, row, getConfig_(), false);
  annotateRow_(sheet, ctx, row, res);
  SpreadsheetApp.getActive().toast(res.message, "CRM Sync");
}

function syncAllRows() {
  var sheet = targetSheet_();
  var ctx = buildContext_(sheet);
  var cfg = getConfig_();
  var last = sheet.getLastRow();
  var ok = 0,
    skipped = 0,
    failed = 0,
    warned = 0;
  for (var row = ctx.headerRow + 1; row <= last; row++) {
    var res = syncRow_(sheet, ctx, row, cfg, true);
    annotateRow_(sheet, ctx, row, res);
    if (res.status === "ok") ok++;
    else if (res.status === "skipped") skipped++;
    else if (res.status === "warn") warned++;
    else failed++;
  }
  SpreadsheetApp.getUi().alert(
    "Sync complete.\n\nSynced: " +
      ok +
      "\nSynced with warnings: " +
      warned +
      " (unmatched closer/setter — check CRM Team names)\nSkipped (empty): " +
      skipped +
      "\nFailed: " +
      failed +
      (failed ? "\n\nFailed rows have a red note on the hidden CRM Sync ID column." : "")
  );
}

// ── Core ────────────────────────────────────────────────────────────────────
function targetSheet_() {
  return findDealSheet_() || SpreadsheetApp.getActive().getActiveSheet();
}

/** Find the tab that has the deal headers, regardless of its name. Prefers the
 *  configured SHEET_NAME if it qualifies. */
function findDealSheet_() {
  var ss = SpreadsheetApp.getActive();
  var preferred = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : null;
  if (preferred && sheetHasDealHeaders_(preferred)) return preferred;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheetHasDealHeaders_(sheets[i])) return sheets[i];
  }
  return null;
}

function sheetHasDealHeaders_(sheet) {
  try {
    buildContext_(sheet);
    return true;
  } catch (err) {
    return false;
  }
}

/** Locate the header row + build a header→column map, ensuring the hidden sync
 *  column exists. */
function buildContext_(sheet) {
  var maxScan = Math.min(15, sheet.getLastRow());
  var headerRow = 0;
  var headers = [];
  for (var r = 1; r <= maxScan; r++) {
    var values = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    var norm = values.map(normHeader_);
    if (norm.indexOf("lead name") !== -1 && norm.indexOf("deal value") !== -1) {
      headerRow = r;
      headers = norm;
      break;
    }
  }
  if (!headerRow) throw new Error('Could not find the header row (needs "Lead Name" and "Deal Value").');

  var col = {};
  for (var field in FIELD_HEADERS) {
    col[field] = findCol_(headers, FIELD_HEADERS[field]);
  }

  // Ensure the hidden sync-id column.
  var syncCol = headers.indexOf(normHeader_(SYNC_ID_HEADER)) + 1;
  if (!syncCol) {
    syncCol = sheet.getLastColumn() + 1;
    sheet.getRange(headerRow, syncCol).setValue(SYNC_ID_HEADER);
    sheet.hideColumns(syncCol);
  }
  return { headerRow: headerRow, col: col, syncCol: syncCol };
}

function syncRow_(sheet, ctx, row, cfg, quiet) {
  var width = sheet.getLastColumn();
  var values = sheet.getRange(row, 1, 1, width).getValues()[0];
  var get = function (field) {
    var c = ctx.col[field];
    return c ? values[c - 1] : "";
  };

  var leadName = String(get("lead_name") || "").trim();
  var dealValue = parseAmount_(get("deal_value"));
  if (!leadName || dealValue == null) {
    return { status: "skipped", message: "Row " + row + " skipped (empty)." };
  }

  // Stable per-row id (stamped once, reused forever → idempotent sync).
  var dealRef = String(values[ctx.syncCol - 1] || "").trim();
  if (!dealRef) {
    dealRef = Utilities.getUuid();
    sheet.getRange(row, ctx.syncCol).setValue(dealRef);
  }

  var payload = {
    event: "deal",
    deal_ref: dealRef,
    lead_name: leadName,
    offer: String(get("offer") || "").trim(),
    deal_value: dealValue,
    closer: String(get("closer") || "").trim(),
    setter: String(get("setter") || "").trim(),
    status: String(get("status") || "").trim(),
    plan_type: String(get("plan_type") || "").trim(),
    source: String(get("source") || "").trim(),
    deal_date: formatDate_(get("deal_date")),
    currency: CURRENCY,
  };

  var resp = UrlFetchApp.fetch(cfg.endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + cfg.apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(resp.getContentText());
  } catch (err) {}

  if (code >= 200 && code < 300 && body.ok) {
    if (body.unmatched && body.unmatched.length) {
      return { status: "warn", message: "Row " + row + " synced, but unmatched: " + body.unmatched.join(", ") };
    }
    return { status: "ok", message: "Row " + row + " synced." };
  }
  var msg = "Row " + row + " failed (" + code + "): " + (body.error || resp.getContentText());
  if (!quiet) SpreadsheetApp.getActive().toast(msg, "CRM Sync error");
  return { status: "failed", message: msg };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function normHeader_(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findCol_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = headers.indexOf(normHeader_(candidates[i]));
    if (idx !== -1) return idx + 1;
  }
  return 0;
}

/** Coerce a cell ("$713.44", "713,44", 713.44) into a Number, or null. */
function parseAmount_(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  var cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  var n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Sheet date cells come back as Date objects; format to yyyy-MM-dd so the CRM
 *  parses them reliably. Pass strings through untouched. */
function formatDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(v || "").trim();
}
