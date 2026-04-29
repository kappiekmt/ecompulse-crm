// Generate a public API key client-side. The plaintext is shown to the user once
// at creation; only the SHA-256 hash + 12-char prefix go to the database.

const KEY_PREFIX = "ek_live"

export interface GeneratedApiKey {
  plaintext: string
  prefix: string
  hashedKey: string
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  // 32 random bytes, base64url-encoded.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const random = base64UrlEncode(bytes)
  const plaintext = `${KEY_PREFIX}_${random}`
  const prefix = plaintext.slice(0, 12) + "…"
  const hashedKey = await sha256Hex(plaintext)
  return { plaintext, prefix, hashedKey }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ""
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
