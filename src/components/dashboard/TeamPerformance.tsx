import * as React from "react"
import { Send } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { initials } from "@/lib/utils"

export interface TeamPerformanceRow {
  id: string
  name: string
  callsBooked: number
  showRate: number
  closeRate: number
  cashCollected: string
}

interface TeamPerformanceProps {
  closers: TeamPerformanceRow[]
  setters: TeamPerformanceRow[]
}

export function TeamPerformance({ closers, setters }: TeamPerformanceProps) {
  const [tab, setTab] = React.useState("closers")

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Team Performance</span>
          </div>
          <Button size="sm">
            <Send className="h-3.5 w-3.5" /> Send Performance Report
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="closers">Closers ({closers.length})</TabsTrigger>
            <TabsTrigger value="setters">Setters ({setters.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="closers">
            <PerformanceTable rows={closers} role="Closer" />
          </TabsContent>
          <TabsContent value="setters">
            <PerformanceTable rows={setters} role="Setter" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function PerformanceTable({ rows, role }: { rows: TeamPerformanceRow[]; role: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] py-10 text-center text-xs text-[var(--color-muted-foreground)]">
        No {role.toLowerCase()}s on the team yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">{role}</th>
            <th className="px-4 py-2.5 text-right font-medium">Calls Booked</th>
            <th className="px-4 py-2.5 text-right font-medium">Show Rate</th>
            <th className="px-4 py-2.5 text-right font-medium">Close Rate</th>
            <th className="px-4 py-2.5 text-right font-medium">Cash Collected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--color-muted)]/40">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
                    {initials(r.name)}
                  </span>
                  <span className="font-medium">{r.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{r.callsBooked}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.showRate.toFixed(1)}%</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.closeRate.toFixed(1)}%</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{r.cashCollected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
