import * as React from "react"
import { Loader2, Plus, Search } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StageBadge, ALL_LEAD_STAGES } from "@/components/leads/StageBadge"
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer"
import { CreateLeadDialog } from "@/components/leads/CreateLeadDialog"
import { useLeadsList, useLeadTagsAll } from "@/lib/queries/leads"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { formatDateTime } from "@/lib/utils"
import type { LeadStage } from "@/lib/database.types"

type SortField = "created_at" | "updated_at" | "full_name" | "stage"

export function Leads() {
  const [search, setSearch] = React.useState("")
  const [stageFilter, setStageFilter] = React.useState<LeadStage | "">("")
  const [closerFilter, setCloserFilter] = React.useState("")
  const [setterFilter, setSetterFilter] = React.useState("")
  const [tagFilter, setTagFilter] = React.useState("")
  const [sortField, setSortField] = React.useState<SortField>("created_at")
  const [sortAsc, setSortAsc] = React.useState(false)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)

  const debouncedSearch = useDebounced(search, 250)

  const closers = useTeamMembers("closer")
  const setters = useTeamMembers("setter")
  const tags = useLeadTagsAll()
  const leads = useLeadsList({
    stages: stageFilter ? [stageFilter] : undefined,
    closerId: closerFilter || null,
    setterId: setterFilter || null,
    tagId: tagFilter || null,
    search: debouncedSearch,
    sortField,
    sortAsc,
    limit: 200,
  })

  function toggleSort(field: SortField) {
    if (sortField === field) setSortAsc((p) => !p)
    else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Leads"
        description="Every lead from Calendly bookings, ad funnels, and manual entry."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-8">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                placeholder="Search name, email, phone, IG…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              className="max-w-[160px]"
              value={stageFilter}
              onChange={(e) => setStageFilter((e.target.value || "") as LeadStage | "")}
            >
              <option value="">All stages</option>
              {ALL_LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <Select
              className="max-w-[160px]"
              value={closerFilter}
              onChange={(e) => setCloserFilter(e.target.value)}
            >
              <option value="">All closers</option>
              {(closers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
            <Select
              className="max-w-[160px]"
              value={setterFilter}
              onChange={(e) => setSetterFilter(e.target.value)}
            >
              <option value="">All setters</option>
              {(setters.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
            <Select
              className="max-w-[160px]"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">All tags</option>
              {(tags.data ?? []).map((t: { id: string; name: string }) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
              {leads.isLoading
                ? "Loading…"
                : `${leads.data?.length ?? 0} lead${leads.data?.length === 1 ? "" : "s"}`}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {leads.isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leads…
              </div>
            ) : !leads.data?.length ? (
              <div className="py-16 text-center">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No leads match the current filters.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSearch("")
                    setStageFilter("")
                    setCloserFilter("")
                    setSetterFilter("")
                    setTagFilter("")
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    <tr>
                      <Th onClick={() => toggleSort("full_name")}>Name</Th>
                      <Th>Contact</Th>
                      <Th onClick={() => toggleSort("stage")}>Stage</Th>
                      <Th>Tags</Th>
                      <Th>Closer</Th>
                      <Th>Setter</Th>
                      <Th>Source</Th>
                      <Th onClick={() => toggleSort("created_at")}>Created</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {leads.data.map((l) => (
                      <tr
                        key={l.id}
                        onClick={() => setActiveId(l.id)}
                        className="cursor-pointer hover:bg-[var(--color-muted)]/40"
                      >
                        <td className="px-4 py-3 font-medium">{l.full_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col text-xs leading-tight">
                            <span>{l.email ?? "—"}</span>
                            {l.phone && (
                              <span className="text-[var(--color-muted-foreground)]">
                                {l.phone}
                              </span>
                            )}
                            {l.instagram && (
                              <span className="text-[var(--color-muted-foreground)]">
                                {l.instagram}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StageBadge stage={l.stage} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {l.tags?.slice(0, 3).map((t) =>
                              t.tag ? (
                                <Badge
                                  key={t.tag_id}
                                  variant={(t.tag.color as never) ?? "muted"}
                                  className="text-[10px]"
                                >
                                  {t.tag.name}
                                </Badge>
                              ) : null
                            )}
                            {(l.tags?.length ?? 0) > 3 && (
                              <Badge variant="muted" className="text-[10px]">
                                +{(l.tags?.length ?? 0) - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                          {l.closer?.full_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                          {l.setter?.full_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                          {l.utm_source ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                          {formatDateTime(l.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LeadDetailDrawer leadId={activeId} onClose={() => setActiveId(null)} />
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function Th({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 text-left font-medium ${
        onClick ? "cursor-pointer select-none hover:text-[var(--color-foreground)]" : ""
      }`}
    >
      {children}
    </th>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
