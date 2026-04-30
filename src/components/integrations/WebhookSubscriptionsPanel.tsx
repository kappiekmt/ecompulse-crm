import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpRight,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SubscriptionDialog } from "@/components/integrations/SubscriptionDialog"
import { DeliveriesLog } from "@/components/integrations/DeliveriesLog"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { cn, formatDateTime } from "@/lib/utils"

interface SubRow {
  id: string
  name: string
  target_url: string
  event_types: string[]
  signing_secret: string | null
  is_active: boolean
  description: string | null
  last_delivered_at: string | null
  last_status: "success" | "failed" | null
  created_at: string
}

export function WebhookSubscriptionsPanel() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<SubRow | null>(null)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [firing, setFiring] = React.useState<string | null>(null)
  const [fireResult, setFireResult] = React.useState<Record<string, string>>({})

  const { data: subs, isLoading } = useQuery<SubRow[]>({
    queryKey: ["webhook-subscriptions"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_subscriptions")
        .select(
          "id, name, target_url, event_types, signing_secret, is_active, description, last_delivered_at, last_status, created_at"
        )
        .order("created_at", { ascending: false })
      if (error) throw error
      return (data ?? []) as SubRow[]
    },
  })

  async function deleteSub(id: string) {
    if (!confirm("Delete this subscription? Future events won't be sent to it.")) return
    await supabase.from("webhook_subscriptions").delete().eq("id", id)
    qc.invalidateQueries({ queryKey: ["webhook-subscriptions"] })
  }

  async function toggleActive(sub: SubRow) {
    await supabase
      .from("webhook_subscriptions")
      .update({ is_active: !sub.is_active })
      .eq("id", sub.id)
    qc.invalidateQueries({ queryKey: ["webhook-subscriptions"] })
  }

  async function testFire(sub: SubRow) {
    setFiring(sub.id)
    setFireResult((p) => ({ ...p, [sub.id]: "" }))
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-fire`
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ subscription_id: sub.id }),
      })
      const json = await res.json()
      const msg = json.ok
        ? `✓ Delivered (HTTP ${json.status})`
        : `✗ ${json.error ?? "Failed"} (HTTP ${json.status ?? "—"})`
      setFireResult((p) => ({ ...p, [sub.id]: msg }))
      qc.invalidateQueries({ queryKey: ["webhook-subscriptions"] })
      qc.invalidateQueries({ queryKey: ["webhook-deliveries", sub.id] })
    } catch (err) {
      setFireResult((p) => ({ ...p, [sub.id]: `✗ ${(err as Error).message}` }))
    } finally {
      setFiring(null)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-secondary)] text-[var(--color-foreground)]">
              <Webhook className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Outbound Webhooks (Zapier, Make, n8n)</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                When events happen in the CRM, the dispatcher POSTs them to every active subscription matching the event type.
              </span>
            </div>
          </div>
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
            disabled={!isSupabaseConfigured}
          >
            <Plus className="h-4 w-4" /> New subscription
          </Button>
        </div>

        {!isSupabaseConfigured ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            Connect Supabase to manage subscriptions.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !subs?.length ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] py-8 text-center">
            <span className="text-sm font-medium">No subscriptions yet</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              In Zapier: pick "Webhooks by Zapier" → "Catch Hook", copy the URL, paste it here.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              Add first subscription
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {subs.map((sub) => (
              <li
                key={sub.id}
                className="flex flex-col gap-3 rounded-md border border-[var(--color-border)]"
              >
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{sub.name}</span>
                      {!sub.is_active && <Badge variant="muted">Paused</Badge>}
                      {sub.last_status === "failed" && (
                        <Badge variant="destructive">Last delivery failed</Badge>
                      )}
                      {sub.last_status === "success" && (
                        <Badge variant="success">Last delivery OK</Badge>
                      )}
                    </div>
                    <a
                      href={sub.target_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 truncate font-mono text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >
                      {sub.target_url}
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </a>
                    {sub.description && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {sub.description}
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {sub.event_types.map((et) => (
                        <Badge key={et} variant="muted" className="font-mono text-[10px]">
                          {et}
                        </Badge>
                      ))}
                    </div>
                    {sub.last_delivered_at && (
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">
                        Last delivery {formatDateTime(sub.last_delivered_at)}
                      </span>
                    )}
                    {fireResult[sub.id] && (
                      <span
                        className={cn(
                          "text-xs font-medium",
                          fireResult[sub.id].startsWith("✓")
                            ? "text-[var(--color-success)]"
                            : "text-[var(--color-destructive)]"
                        )}
                      >
                        {fireResult[sub.id]}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testFire(sub)}
                      disabled={firing === sub.id || !sub.is_active}
                    >
                      {firing === sub.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleActive(sub)}
                      title={sub.is_active ? "Pause" : "Resume"}
                    >
                      {sub.is_active ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditing(sub)
                        setDialogOpen(true)
                      }}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteSub(sub.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-[var(--color-destructive)]" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setExpanded((p) => (p === sub.id ? null : sub.id))}
                      aria-label="Toggle deliveries"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          expanded === sub.id && "rotate-180"
                        )}
                      />
                    </Button>
                  </div>
                </div>

                {expanded === sub.id && (
                  <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                    <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Recent deliveries (live)
                    </span>
                    <DeliveriesLog subscriptionId={sub.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <SubscriptionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existing={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["webhook-subscriptions"] })}
      />
    </Card>
  )
}
