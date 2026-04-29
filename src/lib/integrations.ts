// Per-integration metadata: how the user connects it, where to open it,
// and which inbound webhook receiver (if any) the CRM exposes.

export type IntegrationFieldKind = "text" | "secret" | "textarea"

export interface IntegrationField {
  key: string
  label: string
  kind: IntegrationFieldKind
  placeholder?: string
  helper?: string
  optional?: boolean
}

export interface IntegrationSpec {
  provider: string
  displayName: string
  category: "automation" | "booking" | "payment" | "messaging" | "community" | "marketing" | "data" | "ai"
  description: string
  /** Edge-function path under <project>.supabase.co/functions/v1 that receives webhooks for this provider, if any. */
  webhookPath?: string
  /** Where to send the user when they click the "Open in <service>" button. */
  openUrl: string
  /** Label for the open button (e.g. "Open Zapier", "Open Calendly", "Open Stripe Dashboard"). */
  openLabel: string
  /** Tailwind background classes for the rounded icon square. */
  iconBg: string
  /** Single-letter or short fallback shown inside the icon square. */
  iconLetter: string
  /** Documentation link the user can follow for setup. */
  docsUrl: string
  /** Fields to collect via the connect dialog (saved to integration_configs.config). */
  fields: IntegrationField[]
  /** Webhook events to subscribe to in the external service, surfaced as hint chips. */
  webhookEvents?: string[]
}

export const INTEGRATION_SPECS: IntegrationSpec[] = [
  {
    provider: "zapier",
    displayName: "Zapier",
    category: "automation",
    description: "Connect Calendly, payment processors, and 5000+ apps — no coding required.",
    openUrl: "https://zapier.com/apps",
    openLabel: "Open Zapier",
    iconBg: "bg-orange-500",
    iconLetter: "Z",
    docsUrl: "https://zapier.com/help/create/code-webhooks",
    fields: [],
  },
  {
    provider: "calendly",
    displayName: "Calendly",
    category: "booking",
    description: "Auto-create leads when calls are booked. Direct webhook — no Zapier needed.",
    webhookPath: "/calendly-webhook",
    openUrl: "https://calendly.com/integrations/api_webhooks",
    openLabel: "Open Calendly",
    iconBg: "bg-blue-500",
    iconLetter: "C",
    docsUrl: "https://developer.calendly.com/api-docs/webhook-subscriptions",
    webhookEvents: ["invitee.created", "invitee.canceled"],
    fields: [
      {
        key: "personal_access_token",
        label: "Personal Access Token",
        kind: "secret",
        placeholder: "eyJraWQiOi…",
        helper: "From calendly.com/integrations/api_webhooks → Personal access tokens.",
      },
      {
        key: "signing_key",
        label: "Webhook Signing Key",
        kind: "secret",
        placeholder: "calendly_signing_…",
        helper: "Shown when you create the webhook subscription. Used to verify incoming events.",
      },
    ],
  },
  {
    provider: "slack",
    displayName: "Slack",
    category: "messaging",
    description: "Real-time notifications for leads, payments, deals, and daily reports.",
    openUrl: "https://api.slack.com/apps",
    openLabel: "Open Slack Apps",
    iconBg: "bg-purple-600",
    iconLetter: "S",
    docsUrl: "https://api.slack.com/messaging/sending",
    fields: [
      {
        key: "bot_token",
        label: "Bot User OAuth Token",
        kind: "secret",
        placeholder: "xoxb-…",
        helper: "Create a Slack app, install to workspace, copy the Bot Token.",
      },
      { key: "default_channel", label: "Default Channel", kind: "text", placeholder: "#sales" },
    ],
  },
  {
    provider: "stripe",
    displayName: "Payment Provider",
    category: "payment",
    description: "Connect Stripe, PayPal, or any payment processor via webhook.",
    webhookPath: "/stripe-webhook",
    openUrl: "https://dashboard.stripe.com/webhooks",
    openLabel: "Open Stripe Dashboard",
    iconBg: "bg-indigo-500",
    iconLetter: "$",
    docsUrl: "https://stripe.com/docs/webhooks",
    webhookEvents: [
      "checkout.session.completed",
      "charge.succeeded",
      "charge.refunded",
      "customer.subscription.deleted",
    ],
    fields: [
      { key: "secret_key", label: "Secret Key", kind: "secret", placeholder: "sk_live_…" },
      { key: "webhook_secret", label: "Webhook Signing Secret", kind: "secret", placeholder: "whsec_…" },
    ],
  },
  {
    provider: "instagram",
    displayName: "Instagram DMs",
    category: "messaging",
    description: "Send and receive DMs with leads via Instagram Messaging API.",
    webhookPath: "/instagram-webhook",
    openUrl: "https://developers.facebook.com/apps",
    openLabel: "Open Meta Developer",
    iconBg: "bg-gradient-to-br from-pink-500 to-orange-400",
    iconLetter: "IG",
    docsUrl: "https://developers.facebook.com/docs/instagram-api/guides/messenger-api",
    webhookEvents: ["messages", "messaging_postbacks"],
    fields: [
      { key: "ig_user_id", label: "IG Business Account ID", kind: "text" },
      { key: "page_access_token", label: "Page Access Token", kind: "secret" },
      {
        key: "verify_token",
        label: "Webhook Verify Token",
        kind: "secret",
        helper: "Pick any random string — paste the same value into Meta's webhook UI.",
      },
    ],
  },
  {
    provider: "whatsapp",
    displayName: "WhatsApp Business",
    category: "messaging",
    description: "Send DMs, voice memos, and templates to leads via WhatsApp.",
    openUrl: "https://business.facebook.com/wa/manage",
    openLabel: "Open WhatsApp Manager",
    iconBg: "bg-green-500",
    iconLetter: "W",
    docsUrl: "https://developers.facebook.com/docs/whatsapp",
    fields: [
      { key: "phone_number_id", label: "Phone Number ID", kind: "text" },
      { key: "access_token", label: "Access Token", kind: "secret" },
      { key: "business_account_id", label: "Business Account ID", kind: "text", optional: true },
    ],
  },
  {
    provider: "discord",
    displayName: "Discord",
    category: "community",
    description: "Auto-invite student to community, assign program role on payment.",
    openUrl: "https://discord.com/developers/applications",
    openLabel: "Open Discord Developer",
    iconBg: "bg-indigo-600",
    iconLetter: "D",
    docsUrl: "https://discord.com/developers/applications",
    fields: [
      { key: "bot_token", label: "Bot Token", kind: "secret" },
      { key: "guild_id", label: "Server (Guild) ID", kind: "text" },
    ],
  },
  {
    provider: "whop",
    displayName: "Whop",
    category: "community",
    description: "Create membership, grant program access on payment.",
    openUrl: "https://dash.whop.com",
    openLabel: "Open Whop",
    iconBg: "bg-blue-700",
    iconLetter: "W",
    docsUrl: "https://docs.whop.com/api-reference",
    fields: [
      { key: "api_key", label: "API Key", kind: "secret" },
      { key: "default_product_id", label: "Default Product ID", kind: "text", optional: true },
    ],
  },
  {
    provider: "activecampaign",
    displayName: "ActiveCampaign",
    category: "marketing",
    description: "Add to nurture list, tag by stage, trigger downsell sequences.",
    openUrl: "https://www.activecampaign.com/login",
    openLabel: "Open ActiveCampaign",
    iconBg: "bg-cyan-600",
    iconLetter: "AC",
    docsUrl: "https://developers.activecampaign.com/reference/overview",
    fields: [
      { key: "api_url", label: "API URL", kind: "text", placeholder: "https://<account>.api-us1.com" },
      { key: "api_key", label: "API Key", kind: "secret" },
    ],
  },
  {
    provider: "gmail",
    displayName: "Gmail",
    category: "messaging",
    description: "Pre-call confirmations, onboarding emails, manual follow-ups.",
    openUrl: "https://console.cloud.google.com/apis/credentials",
    openLabel: "Open Google Console",
    iconBg: "bg-red-500",
    iconLetter: "G",
    docsUrl: "https://developers.google.com/gmail/api/guides",
    fields: [
      { key: "client_id", label: "OAuth Client ID", kind: "text" },
      { key: "client_secret", label: "OAuth Client Secret", kind: "secret" },
      { key: "refresh_token", label: "Refresh Token", kind: "secret" },
      { key: "from_email", label: "Send-as Email", kind: "text", placeholder: "team@ecompulse.com" },
    ],
  },
  {
    provider: "google_sheets",
    displayName: "Google Sheets",
    category: "data",
    description: "Mirror finance ledger to a sheet for the accountant.",
    openUrl: "https://console.cloud.google.com",
    openLabel: "Open Google Console",
    iconBg: "bg-emerald-600",
    iconLetter: "GS",
    docsUrl: "https://developers.google.com/sheets/api/guides",
    fields: [
      {
        key: "service_account_json",
        label: "Service Account JSON",
        kind: "textarea",
        helper: "Paste the full JSON. Share the target sheet with the service account's email.",
      },
      { key: "spreadsheet_id", label: "Spreadsheet ID", kind: "text" },
    ],
  },
  {
    provider: "claude",
    displayName: "Claude API",
    category: "ai",
    description: "Lead enrichment, message drafting, summarization.",
    openUrl: "https://console.anthropic.com/settings/keys",
    openLabel: "Open Anthropic Console",
    iconBg: "bg-amber-700",
    iconLetter: "AI",
    docsUrl: "https://docs.anthropic.com",
    fields: [
      { key: "api_key", label: "Anthropic API Key", kind: "secret", placeholder: "sk-ant-…" },
      {
        key: "model",
        label: "Default Model",
        kind: "text",
        placeholder: "claude-opus-4-7",
        optional: true,
      },
    ],
  },
]

export function findIntegrationSpec(provider: string): IntegrationSpec | undefined {
  return INTEGRATION_SPECS.find((s) => s.provider === provider)
}

export function webhookUrlFor(provider: string): string | null {
  const spec = findIntegrationSpec(provider)
  if (!spec?.webhookPath) return null
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base) return null
  return `${base.replace(/\/$/, "")}/functions/v1${spec.webhookPath}`
}

export function publicApiBaseUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base) return null
  return `${base.replace(/\/$/, "")}/functions/v1/public-api`
}

/** The single inbound endpoint shown in the "Your Webhook Endpoint" card. */
export function inboundLeadWebhookUrl(): string | null {
  const base = publicApiBaseUrl()
  return base ? `${base}/lead` : null
}
