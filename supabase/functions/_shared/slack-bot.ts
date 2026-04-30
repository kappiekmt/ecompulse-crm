// Slack Bot helpers — used by the new `slack-app` edge function.
//
// This is distinct from `_shared/slack.ts` (which posts to incoming webhook
// URLs for one-way channel notifications). This module talks to the Slack
// Web API with a bot token and verifies inbound request signatures.

const SLACK_API = "https://slack.com/api"

const enc = new TextEncoder()
const dec = new TextDecoder()

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i]
  return mismatch === 0
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("v0=") ? hex.slice(3) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Verify a Slack request signature per
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 *
 * Returns true if the signature matches and the timestamp is within 5 minutes.
 */
export async function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string,
): Promise<boolean> {
  if (!timestamp || !signature || !signingSecret) return false

  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) return false
  const drift = Math.abs(Math.floor(Date.now() / 1000) - tsNum)
  if (drift > 60 * 5) return false

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`v0:${timestamp}:${rawBody}`),
  )

  return timingSafeEqual(new Uint8Array(mac), hexToBytes(signature))
}

export interface SlackApiResult<T = unknown> {
  ok: boolean
  data: T | null
  error: string | null
}

async function slackApi<T = unknown>(
  method: string,
  body: Record<string, unknown>,
  botToken: string,
): Promise<SlackApiResult<T>> {
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>
    if (!json.ok) return { ok: false, data: null, error: json.error ?? `slack_${method}_failed` }
    return { ok: true, data: json as T, error: null }
  } catch (err) {
    return { ok: false, data: null, error: (err as Error).message }
  }
}

/** Post a message to a channel (or any conversation ID). */
export function postMessage(
  botToken: string,
  args: {
    channel: string
    text?: string
    blocks?: unknown[]
    thread_ts?: string
  },
) {
  return slackApi("chat.postMessage", args as Record<string, unknown>, botToken)
}

/** Open a DM with a user. Returns the resulting channel ID via `channel.id`. */
export function openConversation(botToken: string, userId: string) {
  return slackApi<{ channel: { id: string } }>(
    "conversations.open",
    { users: userId },
    botToken,
  )
}

/** DM a Slack user — convenience wrapper over openConversation + postMessage. */
export async function sendDirectMessage(
  botToken: string,
  userId: string,
  args: { text?: string; blocks?: unknown[] },
) {
  const conv = await openConversation(botToken, userId)
  if (!conv.ok || !conv.data) return conv
  return postMessage(botToken, {
    channel: conv.data.channel.id,
    text: args.text,
    blocks: args.blocks,
  })
}
