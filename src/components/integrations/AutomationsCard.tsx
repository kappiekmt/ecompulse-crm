import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ToggleRight, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

interface AutomationRow {
  key: string
  display_name: string
  description: string | null
  enabled: boolean
}

export function AutomationsCard() {
  const qc = useQueryClient()

  const { data: automations, isLoading } = useQuery<AutomationRow[]>({
    queryKey: ["automation-settings"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_settings")
        .select("key, display_name, description, enabled")
        .order("key")
      if (error) throw error
      return (data ?? []) as AutomationRow[]
    },
  })

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("automation_settings")
        .update({ enabled })
        .eq("key", key)
      if (error) throw error
    },
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: ["automation-settings"] })
      const prev = qc.getQueryData<AutomationRow[]>(["automation-settings"])
      qc.setQueryData<AutomationRow[]>(["automation-settings"], (old) =>
        old?.map((row) => (row.key === key ? { ...row, enabled } : row)) ?? []
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["automation-settings"], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["automation-settings"] })
    },
  })

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-secondary)] text-[var(--color-foreground)]">
            <ToggleRight className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Automations</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Turn individual automations on or off. Changes save instantly.
            </span>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            Connect Supabase to manage automations.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {automations?.map((row) => (
              <li
                key={row.key}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{row.display_name}</span>
                  {row.description && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {row.description}
                    </span>
                  )}
                </div>
                <Switch
                  checked={row.enabled}
                  onCheckedChange={(enabled) =>
                    toggle.mutate({ key: row.key, enabled })
                  }
                  aria-label={`Toggle ${row.display_name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
