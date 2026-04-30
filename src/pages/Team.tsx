import * as React from "react"
import { Loader2, Pause, Play, Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { InviteMemberDialog } from "@/components/team/InviteMemberDialog"
import { useTeamList, useUpdateTeamMember, type TeamMemberRow } from "@/lib/queries/team"
import { initials } from "@/lib/utils"
import { normalizeSlackId } from "@/lib/slack"
import type { TeamRole } from "@/lib/database.types"

const ROLE_DESCRIPTIONS = [
  { role: "Admin", description: "Owner / ops. Full access to all data, automations, and team management." },
  { role: "Closer", description: "Runs strategy calls. Sees their assigned leads, pre-call SOPs, and personal stats." },
  { role: "Setter", description: "Books calls. Sees their bookings, attribution, and conversion to sale." },
  { role: "Coach", description: "Delivers the program. Sees only assigned students, their onboarding, and notes." },
]

export function Team() {
  const team = useTeamList()
  const update = useUpdateTeamMember()
  const [inviteOpen, setInviteOpen] = React.useState(false)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Team"
        description="Add closers, setters, and coaches. Set roles, capacity, and commission splits."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" /> Invite member
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <h2 className="text-sm font-semibold">Role permissions</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {ROLE_DESCRIPTIONS.map((r) => (
                <div
                  key={r.role}
                  className="flex flex-col gap-1.5 rounded-md border border-[var(--color-border)] p-4"
                >
                  <Badge variant="outline">{r.role}</Badge>
                  <p className="text-sm text-[var(--color-muted-foreground)]">{r.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Members</h2>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {team.data?.length ?? 0} total
              </span>
            </div>
            {team.isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !team.data?.length ? (
              <p className="rounded-md border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                No team members yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Member</th>
                      <th className="px-4 py-2.5 text-left font-medium">Role</th>
                      <th className="px-4 py-2.5 text-left font-medium">Timezone</th>
                      <th className="px-4 py-2.5 text-left font-medium">Slack ID</th>
                      <th className="px-4 py-2.5 text-left font-medium">Commission %</th>
                      <th className="px-4 py-2.5 text-left font-medium">Capacity</th>
                      <th className="px-4 py-2.5 text-left font-medium">Status</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {team.data.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        onPatch={(patch) =>
                          update.mutate({ id: m.id, patch })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}

function MemberRow({
  member,
  onPatch,
}: {
  member: TeamMemberRow
  onPatch: (patch: Partial<TeamMemberRow>) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [role, setRole] = React.useState<TeamRole>(member.role)
  const [tz, setTz] = React.useState(member.timezone ?? "")
  const [comm, setComm] = React.useState(member.commission_pct?.toString() ?? "")
  const [cap, setCap] = React.useState(member.capacity?.toString() ?? "")
  const [slack, setSlack] = React.useState(member.slack_user_id ?? "")

  function save() {
    onPatch({
      role,
      timezone: tz.trim() || null,
      commission_pct: comm ? Number(comm) : null,
      capacity: cap ? Number(cap) : null,
      slack_user_id: normalizeSlackId(slack),
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <tr className="bg-[var(--color-muted)]/40">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
              {initials(member.full_name)}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{member.full_name}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">{member.email}</span>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <Select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
            <option value="admin">admin</option>
            <option value="closer">closer</option>
            <option value="setter">setter</option>
            <option value="coach">coach</option>
          </Select>
        </td>
        <td className="px-4 py-3">
          <Input value={tz} onChange={(e) => setTz(e.target.value)} />
        </td>
        <td className="px-4 py-3">
          <Input
            placeholder="U07ABC123"
            value={slack}
            onChange={(e) => setSlack(e.target.value)}
          />
        </td>
        <td className="px-4 py-3">
          <Input
            type="number"
            step="0.1"
            value={comm}
            onChange={(e) => setComm(e.target.value)}
          />
        </td>
        <td className="px-4 py-3">
          <Input type="number" value={cap} onChange={(e) => setCap(e.target.value)} />
        </td>
        <td className="px-4 py-3">
          <Badge variant={member.is_active ? "success" : "muted"}>
            {member.is_active ? "Active" : "Paused"}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="hover:bg-[var(--color-muted)]/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[10px] font-semibold">
            {initials(member.full_name)}
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{member.full_name}</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">{member.email}</span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="capitalize">{member.role}</Badge>
      </td>
      <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
        {member.timezone ?? "—"}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-[var(--color-muted-foreground)]">
        {member.slack_user_id ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs tabular-nums">
        {member.commission_pct != null ? `${member.commission_pct}%` : "—"}
      </td>
      <td className="px-4 py-3 text-xs tabular-nums">
        {member.capacity ?? "—"}
      </td>
      <td className="px-4 py-3">
        <Badge variant={member.is_active ? "success" : "muted"}>
          {member.is_active ? "Active" : "Paused"}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onPatch({ is_active: !member.is_active })}
          aria-label={member.is_active ? "Deactivate" : "Reactivate"}
        >
          {member.is_active ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </td>
    </tr>
  )
}
