// Coaching offer tiers. The four prices live in our pricing page, so the
// CRM mirrors them here for tier pickers and amount-based fallback in the
// Stripe webhook (in cents, EUR).

export const TIERS = [
  {
    key: "fundament",
    label: "Fundament",
    program: "Fundament",
    price_cents: 99700,
  },
  {
    key: "groepscoaching",
    label: "Groepscoaching",
    program: "Groepscoaching",
    price_cents: 299700,
  },
  {
    key: "1_on_1",
    label: "1-1 Coaching",
    program: "1-1 Coaching",
    price_cents: 499700,
  },
  {
    key: "nick_1_on_1",
    label: "Nick 1-1",
    program: "Nick 1-1",
    price_cents: 699700,
  },
] as const

export type TierKey = (typeof TIERS)[number]["key"]

export function tierByKey(key: string | null | undefined) {
  if (!key) return null
  return TIERS.find((t) => t.key === key) ?? null
}

/**
 * Match a payment amount to the closest coaching tier.
 *
 * Rather than requiring an exact match, we pick the nearest tier within
 * €1,500 — this absorbs VAT (21%), discounts of a few hundred €, deposit
 * payments etc. The 4 tiers are €2,000 apart so this never collides.
 *
 * On a tie (e.g. €5,997 is exactly between 1-1 and Nick 1-1), the higher
 * tier wins — paying more usually signals the bigger package.
 */
export function tierByAmountCents(cents: number | null | undefined) {
  if (!cents) return null
  const tolerance = 150_000 // €1,500
  let best: (typeof TIERS)[number] | null = null
  let bestDelta = Infinity
  for (const t of TIERS) {
    const delta = Math.abs(t.price_cents - cents)
    if (delta > tolerance) continue
    if (delta < bestDelta || (delta === bestDelta && best && t.price_cents > best.price_cents)) {
      best = t
      bestDelta = delta
    }
  }
  return best
}
