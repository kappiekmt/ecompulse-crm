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
 *   2. Run `setupCredentials` once (or use the CRM Sync menu → "Set credentials…")
 *      and paste the endpoint URL + API key.
 *   3. Run `installAutoSync` once (or menu → "Install auto-sync") and authorize.
 *   4. Menu → "CRM Sync" → "Sync all rows" to backfill existing deals.
 *
 * After that, flipping a row's Status to Paid (or editing a row) auto-syncs it.
 */

// ── Config ──────────────────────────────────────────────────────────────────
var SHEET_NAME = "Deal Log"; // tab to read; null = active sheet
var SYNC_ID_HEADER = "CRM Sync ID"; // hidden column this script manages
var CURRENCY = "USD"; // the sheet logs $ values

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
  ui.alert("Saved. Run 'Install auto-sync' next, then 'Sync all rows' to backfill.");
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
    if (existing[i].getHandlerFunction() === "onEditAutoSync") ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger("onEditAutoSync").forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert("Auto-sync installed. Edited / newly-Paid rows now sync automatically.");
}

function onEditAutoSync(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (SHEET_NAME && sheet.getName() !== SHEET_NAME) return;
  var ctx = buildContext_(sheet);
  var row = e.range.getRow();
  if (row <= ctx.headerRow) return; // header / title rows
  if (e.range.getColumn() === ctx.syncCol) return; // ignore our own stamp
  syncRow_(sheet, ctx, row, getConfig_(), true);
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
      failed
  );
}

// ── Core ────────────────────────────────────────────────────────────────────
function targetSheet_() {
  var ss = SpreadsheetApp.getActive();
  return (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getActiveSheet();
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
