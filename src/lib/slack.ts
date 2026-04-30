/**
 * Strip whitespace + Slack-mention wrapping (e.g. `<@U07…>` or `@U07…`) so we
 * always store just the bare ID like `U07ABC123`.
 *
 * Slack member IDs start with U (regular users) or W (workspace-shared users)
 * followed by 8–10 alphanumeric chars. We don't strictly validate — store
 * whatever the admin pastes and let Slack reject malformed ones at message
 * delivery time.
 */
export function normalizeSlackId(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().replace(/^<?@?/, "").replace(/>$/, "")
  return trimmed || null
}

/** Wrap a stored Slack ID into Slack's `<@…>` mention format for messages. */
export function slackMention(id: string | null | undefined): string | null {
  const normalized = normalizeSlackId(id)
  return normalized ? `<@${normalized}>` : null
}
