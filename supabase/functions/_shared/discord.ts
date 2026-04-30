// Thin Discord REST helpers for the bot flow.
//
// All calls hit https://discord.com/api/v10 with `Authorization: Bot <token>`
// and the bot must already be invited to the guild with the right intents
// and permissions:
//   - Manage Server (or at minimum Create Instant Invite on the channel)
//   - Manage Roles (later, for tier-role assignment)
//
// We deliberately keep this tiny — only the calls the integration needs.

const DISCORD_API = "https://discord.com/api/v10"

export interface DiscordInvite {
  code: string
  url: string
  channel_id: string
  expires_at: string | null
  uses: number
  max_uses: number
}

export interface DiscordError {
  status: number
  message: string
  raw: string
}

async function discordFetch(
  botToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "EcomPulse-CRM (https://coaching.joinecompulse.com, 1.0)",
    },
  })
}

/**
 * Create a one-time, single-use invite for a channel. The bot must have
 * `Create Instant Invite` permission on the target channel.
 *
 * @param maxAgeSeconds 0 = never expires, otherwise seconds (Discord caps at 604800 = 7d)
 */
export async function createChannelInvite(args: {
  botToken: string
  channelId: string
  maxAgeSeconds?: number
  maxUses?: number
  reason?: string
}): Promise<DiscordInvite | DiscordError> {
  const maxAge = args.maxAgeSeconds ?? 7 * 24 * 3600
  const maxUses = args.maxUses ?? 1
  const res = await discordFetch(args.botToken, `/channels/${args.channelId}/invites`, {
    method: "POST",
    headers: args.reason ? { "X-Audit-Log-Reason": args.reason } : undefined,
    body: JSON.stringify({
      max_age: maxAge,
      max_uses: maxUses,
      unique: true,
      temporary: false,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    return { status: res.status, message: `Discord ${res.status}`, raw: text.slice(0, 500) }
  }
  let json: { code?: string; expires_at?: string | null; channel?: { id: string }; uses?: number; max_uses?: number }
  try {
    json = JSON.parse(text)
  } catch {
    return { status: 500, message: "Invalid JSON from Discord", raw: text.slice(0, 500) }
  }
  if (!json.code) {
    return { status: 500, message: "Discord did not return an invite code", raw: text.slice(0, 500) }
  }
  return {
    code: json.code,
    url: `https://discord.gg/${json.code}`,
    channel_id: json.channel?.id ?? args.channelId,
    expires_at: json.expires_at ?? null,
    uses: json.uses ?? 0,
    max_uses: json.max_uses ?? maxUses,
  }
}

export function isDiscordError(x: unknown): x is DiscordError {
  return typeof x === "object" && x !== null && "status" in x && "message" in x && "raw" in x
}
