// Helpers for posting Slack messages from edge functions.
//
// All notifications go through Slack incoming webhook URLs stored in
// integration_configs.config under the slack provider. Callers grab the right
// URL (eod_webhook_url, bookings_webhook_url, payments_webhook_url, …) and
// pass it to postToSlack along with the formatted message.

const PUBLIC_APP_URL =
  Deno.env.get("PUBLIC_APP_URL") ?? "https://coaching.joinecompulse.com"

export function leadDeepLink(leadId: string): string {
  return `${PUBLIC_APP_URL}/leads?id=${leadId}`
}

/** Wrap a stored Slack user ID into Slack's `<@…>` mention. */
export function slackMention(slackUserId: string | null | undefined): string | null {
  if (!slackUserId) return null
  const cleaned = slackUserId
    .trim()
    .replace(/^<?@?/, "")
    .replace(/>$/, "")
  return cleaned ? `<@${cleaned}>` : null
}

/** Format an ISO timestamp for display in the closer's local timezone. */
export function formatLocalTime(
  iso: string | null | undefined,
  timezone?: string | null
): string {
  if (!iso) return "—"
  const tz = timezone ?? "UTC"
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  ) as Record<string, string>
  const tzShort = tz.split("/").pop() ?? tz
  return `${parts.weekday}, ${parts.month} ${parts.day} ${parts.year} · ${parts.hour}:${parts.minute} ${parts.dayPeriod} (${tzShort})`
}

export interface SlackPostResult {
  ok: boolean
  status: number | null
  body: string
  error: string | null
}

export async function postToSlack(
  webhookUrl: string,
  body: Record<string, unknown>
): Promise<SlackPostResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const text = (await res.text()).slice(0, 200)
    return {
      ok: res.ok,
      status: res.status,
      body: text,
      error: res.ok ? null : `Slack returned ${res.status}: ${text}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: "",
      error: (err as Error).message,
    }
  }
}
