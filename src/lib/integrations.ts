// Per-integration metadata: what fields the user must paste in,
// which webhook receiver (if any) is exposed, where to find docs.

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
  category: "booking" | "payment" | "messaging" | "community" | "marketing" | "data" | "ai"
  description: string
  /** Edge-function path (under <project>.functions.supabase.co) that receives webhooks for this provider, if any. */
  webhookPath?: string
  /** Documentation link the user can follow to find their keys / set up the webhook. */
  docsUrl: string
  /** Fields the user fills in to connect. Stored under integration_configs.config (non-secrets) and Vault (secrets). */
  fields: IntegrationField[]
  /** Whether to show "Subscribe Calendly to: invitee.created, invitee.canceled" style hints in the UI. */
  webhookEvents?: string[]
}

export const INTEGRATION_SPECS: IntegrationSpec[] = [
  {
    provider: "calendly",
    displayName: "Calendly",
    category: "booking",
    description: "New strategy-call bookings → create lead, assign closer by email, schedule 15-min reminder.",
    webhookPath: "/calendly-webhook",
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
      {
        key: "organization_uri",
        label: "Organization URI",
        kind: "text",
        placeholder: "https://api.calendly.com/organizations/…",
        helper: "GET /users/me to find this.",
        optional: true,
      },
    ],
  },
  {
    provider: "stripe",
    displayName: "Stripe",
    category: "payment",
    description: "Payment success → start onboarding chain. Refund → flag deal.",
    webhookPath: "/stripe-webhook",
    docsUrl: "https://dashboard.stripe.com/webhooks",
    webhookEvents: [
      "checkout.session.completed",
      "charge.succeeded",
      "charge.refunded",
      "customer.subscription.deleted",
    ],
    fields: [
      {
        key: "secret_key",
        label: "Secret Key",
        kind: "secret",
        placeholder: "sk_live_…",
        helper: "From dashboard.stripe.com/apikeys.",
      },
      {
        key: "webhook_secret",
        label: "Webhook Signing Secret",
        kind: "secret",
        placeholder: "whsec_…",
        helper: "Created when you add the webhook endpoint. Used to verify signatures.",
      },
    ],
  },
  {
    provider: "slack",
    displayName: "Slack",
    category: "messaging",
    description: "Booking alerts, 15-min reminders, coach DMs, finance updates.",
    docsUrl: "https://api.slack.com/apps",
    fields: [
      {
        key: "bot_token",
        label: "Bot User OAuth Token",
        kind: "secret",
        placeholder: "xoxb-…",
        helper: "Create a Slack app, install to workspace, copy the Bot Token.",
      },
      {
        key: "default_channel",
        label: "Default Channel",
        kind: "text",
        placeholder: "#sales",
      },
    ],
  },
  {
    provider: "discord",
    displayName: "Discord",
    category: "community",
    description: "Auto-invite student to community, assign program role.",
    docsUrl: "https://discord.com/developers/applications",
    fields: [
      { key: "bot_token", label: "Bot Token", kind: "secret", placeholder: "MTI…" },
      { key: "guild_id", label: "Server (Guild) ID", kind: "text", placeholder: "12345…" },
    ],
  },
  {
    provider: "whop",
    displayName: "Whop",
    category: "community",
    description: "Create membership, grant program access on payment.",
    docsUrl: "https://docs.whop.com/api-reference",
    fields: [
      { key: "api_key", label: "API Key", kind: "secret", placeholder: "wh_…" },
      { key: "default_product_id", label: "Default Product ID", kind: "text", optional: true },
    ],
  },
  {
    provider: "activecampaign",
    displayName: "ActiveCampaign",
    category: "marketing",
    description: "Add to nurture list, tag by stage, trigger downsell sequences.",
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
    description: "Mirror finance ledger for the accountant.",
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
    provider: "instagram",
    displayName: "Instagram",
    category: "messaging",
    description: "Pull DMs into IG Chat, attribute to leads, reply from CRM.",
    webhookPath: "/instagram-webhook",
    docsUrl: "https://developers.facebook.com/docs/instagram-api/guides/messenger-api",
    webhookEvents: ["messages", "messaging_postbacks"],
    fields: [
      { key: "ig_user_id", label: "IG Business Account ID", kind: "text" },
      { key: "page_access_token", label: "Page Access Token", kind: "secret" },
      {
        key: "verify_token",
        label: "Webhook Verify Token",
        kind: "secret",
        helper: "Set this to any random string — paste the same value into Meta's webhook UI.",
      },
    ],
  },
  {
    provider: "claude",
    displayName: "Claude API",
    category: "ai",
    description: "Lead enrichment, message drafting, summarization.",
    docsUrl: "https://console.anthropic.com/settings/keys",
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

/**
 * Resolve the public webhook URL for a provider based on the configured Supabase URL.
 * Returns null if no Supabase URL is set or the integration has no inbound webhook.
 */
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
