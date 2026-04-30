// Mirror of src/lib/tiers.ts for edge-function (Deno) consumption.
// Keep these two files in sync — they describe the same coaching offer.

export const TIERS = [
  { key: "fundament",     label: "Fundament",      program: "Fundament",      price_cents: 99700 },
  { key: "groepscoaching", label: "Groepscoaching", program: "Groepscoaching", price_cents: 299700 },
  { key: "1_on_1",         label: "1-1 Coaching",   program: "1-1 Coaching",   price_cents: 499700 },
  { key: "nick_1_on_1",    label: "Nick 1-1",       program: "Nick 1-1",       price_cents: 699700 },
] as const

export type TierKey = (typeof TIERS)[number]["key"]

export function tierByKey(key: string | null | undefined) {
  if (!key) return null
  return TIERS.find((t) => t.key === key) ?? null
}

export function tierByAmountCents(cents: number | null | undefined) {
  if (!cents) return null
  const tolerance = 500
  return TIERS.find((t) => Math.abs(t.price_cents - cents) <= tolerance) ?? null
}
