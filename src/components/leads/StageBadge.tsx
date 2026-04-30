import { Badge } from "@/components/ui/badge"
import type { LeadStage } from "@/lib/database.types"

const STAGE_VARIANTS: Record<
  LeadStage,
  {
    label: string
    variant:
      | "default"
      | "secondary"
      | "outline"
      | "success"
      | "warning"
      | "destructive"
      | "muted"
  }
> = {
  new: { label: "New", variant: "muted" },
  booked: { label: "Booked", variant: "outline" },
  confirmed: { label: "Confirmed", variant: "secondary" },
  showed: { label: "Showed", variant: "default" },
  no_show: { label: "No-show", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "muted" },
  pitched: { label: "Pitched", variant: "warning" },
  won: { label: "Closed", variant: "success" },
  lost: { label: "Lost", variant: "destructive" },
  follow_up_short: { label: "Follow up short", variant: "warning" },
  follow_up_long: { label: "Follow up long", variant: "muted" },
  onboarding: { label: "Onboarding", variant: "warning" },
  active_student: { label: "Active student", variant: "success" },
  churned: { label: "Churned", variant: "destructive" },
  refunded: { label: "Refunded", variant: "destructive" },
}

export function StageBadge({ stage }: { stage: LeadStage }) {
  const cfg = STAGE_VARIANTS[stage]
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}

export const ALL_LEAD_STAGES: LeadStage[] = [
  "new",
  "booked",
  "confirmed",
  "showed",
  "no_show",
  "cancelled",
  "pitched",
  "won",
  "lost",
  "follow_up_short",
  "follow_up_long",
  "onboarding",
  "active_student",
  "churned",
  "refunded",
]

/** The 8 statuses surfaced as quick-pick pills in the lead detail drawer. */
export const QUICK_PICK_STAGES: LeadStage[] = [
  "booked",
  "showed",
  "no_show",
  "cancelled",
  "won",
  "lost",
  "follow_up_short",
  "follow_up_long",
]

export function stageLabel(stage: LeadStage): string {
  return STAGE_VARIANTS[stage].label
}
