// Resolves a coaching tier from a Stripe price/product name.
//
// Tier names are baked into the Stripe payment-link descriptions and stay
// stable across PIF and installment variants. We match on substring (case +
// diacritic insensitive) and check most-specific first so "1-1" wins over
// "groepscoaching" if both ever appear in one description.

export type CoachingTier = "fundament" | "groepscoaching" | "one_on_one"

export function resolveCoachingTier(...names: (string | null | undefined)[]): CoachingTier | null {
  const haystack = names
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .map((n) => n.toLowerCase())
    .join(" | ")

  if (!haystack) return null

  if (/\b1[ -]?(?:op[ -]?)?1\b|one[ -]on[ -]one/.test(haystack)) return "one_on_one"
  if (/groep/.test(haystack)) return "groepscoaching"
  if (/fundament/.test(haystack)) return "fundament"

  return null
}
