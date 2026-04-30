import { Badge } from "@/components/ui/badge"
import type { LeadStage } from "@/lib/database.types"

const STAGE_VARIANTS: Record<LeadStage, { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted" }> = {
  new: { label: "New", variant: "muted" },
  booked: { label: "Booked", variant: "outline" },
  confirmed: { label: "Confirmed", variant: "secondary" },
  showed: { label: "Showed", variant: "default" },
  no_show: { label: "No-show", variant: "destructive" },
  pitched: { label: "Pitched", variant: "warning" },
  won: { label: "Won", variant: "success" },
  lost: { label: "Lost", variant: "destructive" },
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
  "pitched",
  "won",
  "lost",
  "onboarding",
  "active_student",
  "churned",
  "refunded",
]
