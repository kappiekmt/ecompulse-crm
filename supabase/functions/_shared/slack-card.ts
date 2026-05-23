// Standardized Slack notification card primitives.
//
// Every Slack-posting function in this project should import its header,
// footer, and any "Open in CRM" CTA from here — so a coach-assigned card,
// an EOD report, a deal-closed alert, and a recovery escalation all visibly
// belong to the same product.
//
// Convention:
//   ┌─ HEADER  "{emoji}  {Title}  ·  {subtitle?}"   (Unicode emoji, double
//   │                                                space, middle dot)
//   │  …card body (sections, fields, optional payment schedule, notes…)
//   │  …optional actions row — "Open in CRM" is always the LAST button and
//   │     uses style:"primary" (matches CRM button convention: primary right).
//   └─ FOOTER  "EcomPulse CRM  ·  {category}"       (small context block)
//
// Pick the icon from ICON below — don't reach for arbitrary emoji per card.
// Slack emoji shortcodes (:moneybag:) are NOT used here; they render fine but
// drift visually across clients. Unicode is consistent everywhere.

export const ICON = {
  booking: "📅",
  cancellation: "🚫",
  precall: "⏰",
  payment: "💰",
  coach: "👋",
  onboarding: "🎓",
  installment: "🧾",
  overdue: "⚠️",
  recovery: "🚨",
  commission: "💸",
  eod: "🌙",
  eow: "📊",
  recap: "📈",
  test: "🧪",
} as const

/** Standard header block. Format: "{emoji}  {Title}  ·  {subtitle?}". */
export function cardHeader(icon: string, title: string, subtitle?: string) {
  const text = subtitle ? `${icon}  ${title}  ·  ${subtitle}` : `${icon}  ${title}`
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  }
}

/** Standard footer (small grey context line at the bottom of every card). */
export function cardFooter(category: string) {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: `EcomPulse CRM  ·  ${category}` }],
  }
}

import { leadDeepLink } from "./slack.ts"

/** Standard "Open in CRM" primary button. Always rendered last in any actions row. */
export function openInCrmButton(leadId: string) {
  return {
    type: "button",
    text: { type: "plain_text", text: "Open in CRM", emoji: true },
    url: leadDeepLink(leadId),
    style: "primary",
  } as const
}

export const divider = { type: "divider" } as const
