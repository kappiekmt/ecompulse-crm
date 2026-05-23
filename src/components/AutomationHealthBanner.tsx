import { Link } from "react-router-dom"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAutomationStatuses } from "@/lib/queries/automations"

/**
 * Small alert banner shown on dashboards when one or more automations need
 * attention. Stays out of the way (no banner) when everything's healthy.
 * Click-through goes to /automations for the full health table.
 */
export function AutomationHealthBanner() {
  const { data } = useAutomationStatuses()
  if (!data) return null
  const failed = data.filter((s) => s.health === "failed")
  const warning = data.filter((s) => s.health === "warning")
  if (failed.length === 0 && warning.length === 0) return null

  const tone = failed.length > 0 ? "destructive" : "warning"
  const total = failed.length + warning.length
  const previewNames = [...failed, ...warning]
    .slice(0, 3)
    .map((s) => s.meta.name)
    .join(", ")
  const remaining = total - 3

  return (
    <Card
      className={
        tone === "destructive"
          ? "border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5"
          : "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5"
      }
    >
      <CardContent className="flex items-center justify-between gap-4 p-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle
            className={
              tone === "destructive"
                ? "h-4 w-4 text-[var(--color-destructive)]"
                : "h-4 w-4 text-[var(--color-warning)]"
            }
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {failed.length > 0
                ? `${failed.length} automation${failed.length > 1 ? "s" : ""} failed`
                : `${warning.length} automation${warning.length > 1 ? "s" : ""} need attention`}
              {failed.length > 0 && warning.length > 0 && ` · ${warning.length} warning${warning.length > 1 ? "s" : ""}`}
            </span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {previewNames}
              {remaining > 0 && ` + ${remaining} more`}
            </span>
          </div>
        </div>
        <Link
          to="/automations"
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-foreground)] hover:underline"
        >
          View health <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  )
}
