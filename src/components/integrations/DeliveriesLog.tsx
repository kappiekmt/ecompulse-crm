import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"
import { formatDateTime } from "@/lib/utils"

interface Delivery {
  id: string
  event_type: string
  status: "pending" | "success" | "failed"
  attempts: number
  response_status: number | null
  error: string | null
  created_at: string
}

interface DeliveriesLogProps {
  subscriptionId: string
}

export function DeliveriesLog({ subscriptionId }: DeliveriesLogProps) {
  const qc = useQueryClient()

  const { data: deliveries, isLoading } = useQuery<Delivery[]>({
    queryKey: ["webhook-deliveries", subscriptionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_deliveries")
        .select("id, event_type, status, attempts, response_status, error, created_at")
        .eq("subscription_id", subscriptionId)
        .order("created_at", { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as Delivery[]
    },
  })

  React.useEffect(() => {
    const channel = supabase
      .channel(`deliveries-${subscriptionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "webhook_deliveries",
          filter: `subscription_id=eq.${subscriptionId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["webhook-deliveries", subscriptionId] })
          qc.invalidateQueries({ queryKey: ["webhook-subscriptions"] })
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [subscriptionId, qc])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-[var(--color-muted-foreground)]">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading deliveries…
      </div>
    )
  }

  if (!deliveries?.length) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
        No deliveries yet. Trigger an event or hit "Test" above.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
      <table className="w-full text-xs">
        <thead className="bg-[var(--color-muted)] text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Event</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Code</th>
            <th className="px-3 py-2 text-left font-medium">Time</th>
            <th className="px-3 py-2 text-left font-medium">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {deliveries.map((d) => (
            <tr key={d.id} className="hover:bg-[var(--color-muted)]/40">
              <td className="px-3 py-2 font-mono">{d.event_type}</td>
              <td className="px-3 py-2">
                <Badge
                  variant={
                    d.status === "success"
                      ? "success"
                      : d.status === "failed"
                      ? "destructive"
                      : "muted"
                  }
                >
                  {d.status}
                </Badge>
              </td>
              <td className="px-3 py-2 tabular-nums">
                {d.response_status ?? "—"}
              </td>
              <td className="px-3 py-2 text-[var(--color-muted-foreground)]">
                {formatDateTime(d.created_at)}
              </td>
              <td className="px-3 py-2 max-w-[260px] truncate text-[var(--color-destructive)]">
                {d.error ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
