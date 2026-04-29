import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Loader2, AlertTriangle, Trash2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { generateApiKey } from "@/lib/apiKey"
import { publicApiBaseUrl } from "@/lib/integrations"
import { formatDateTime } from "@/lib/utils"

type ApiKeyScope = "lead.create" | "payment.create" | "read.basic"

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  scopes: ApiKeyScope[]
  status: "active" | "revoked"
  created_at: string
  last_used_at: string | null
}

const ALL_SCOPES: { value: ApiKeyScope; label: string }[] = [
  { value: "lead.create", label: "lead.create" },
  { value: "payment.create", label: "payment.create" },
  { value: "read.basic", label: "read.basic" },
]

export function ApiKeysPanel() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)

  const { data: keys, isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ["api-keys"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys_safe_v")
        .select("id, name, prefix, scopes, status, created_at, last_used_at")
        .order("created_at", { ascending: false })
      if (error) throw error
      return (data ?? []) as ApiKeyRow[]
    },
  })

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Any system using it will fail immediately.")) return
    await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id)
    qc.invalidateQueries({ queryKey: ["api-keys"] })
  }

  const baseUrl = publicApiBaseUrl()

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">CRM API Keys</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              For landing pages, Zapier, or partners pushing leads/payments into the CRM.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={!isSupabaseConfigured}>
            <Plus className="h-4 w-4" /> New API key
          </Button>
        </div>

        {baseUrl && <CopyableUrl label="Base URL" value={baseUrl} />}
        {!baseUrl && (
          <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs">
            Set <code className="font-mono">VITE_SUPABASE_URL</code> in <code className="font-mono">.env.local</code> to see the public API base URL.
          </div>
        )}

        {!isSupabaseConfigured ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted-foreground)]">
            Connect Supabase to manage API keys.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading keys…
          </div>
        ) : !keys?.length ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted-foreground)]">
            No API keys yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prefix</th>
                  <th className="px-4 py-2.5 text-left font-medium">Scopes</th>
                  <th className="px-4 py-2.5 text-left font-medium">Last used</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-[var(--color-muted)]/40">
                    <td className="px-4 py-3 font-medium">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{k.prefix}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="muted" className="font-mono">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                      {k.last_used_at ? formatDateTime(k.last_used_at) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={k.status === "active" ? "success" : "muted"}>
                        {k.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.status === "active" && (
                        <Button variant="ghost" size="icon" onClick={() => revoke(k.id)} aria-label="Revoke">
                          <Trash2 className="h-4 w-4 text-[var(--color-destructive)]" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["api-keys"] })}
      />
    </Card>
  )
}

interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

function CreateApiKeyDialog({ open, onOpenChange, onCreated }: CreateApiKeyDialogProps) {
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<ApiKeyScope[]>(["lead.create"])
  const [submitting, setSubmitting] = React.useState(false)
  const [created, setCreated] = React.useState<{ plaintext: string; prefix: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setName("")
      setScopes(["lead.create"])
      setCreated(null)
      setError(null)
    }
  }, [open])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    if (!scopes.length) {
      setError("Pick at least one scope")
      return
    }
    setError(null)
    setSubmitting(true)
    const generated = await generateApiKey()
    const { error: dbErr } = await supabase.from("api_keys").insert({
      name: name.trim(),
      prefix: generated.prefix,
      hashed_key: generated.hashedKey,
      scopes,
    })
    setSubmitting(false)
    if (dbErr) {
      setError(dbErr.message)
      return
    }
    setCreated({ plaintext: generated.plaintext, prefix: generated.prefix })
    onCreated()
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "API key created" : "Create API key"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Copy this key now. It will not be shown again."
              : "Generate a key for an external system to call the CRM."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <DialogBody>
              <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Treat this like a password. Anyone with it can post into the CRM.
                </span>
              </div>
              <CopyableUrl label="API key" value={created.plaintext} />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Use it as a bearer token: <code className="font-mono">Authorization: Bearer {created.prefix}…</code>
              </p>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogBody>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. Landing page intake"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Scopes</Label>
                <div className="flex flex-col gap-1.5">
                  {ALL_SCOPES.map((s) => (
                    <label
                      key={s.value}
                      className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(s.value)}
                        onChange={() => toggleScope(s.value)}
                      />
                      <code className="font-mono text-xs">{s.label}</code>
                    </label>
                  ))}
                </div>
              </div>
              {error && (
                <p className="text-xs text-[var(--color-destructive)]">{error}</p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
