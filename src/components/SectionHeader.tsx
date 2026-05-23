/**
 * Subtle in-page section divider. Use to group related KPIs or table cards
 * on a dashboard so the page scans cleanly instead of presenting a wall of
 * identical cards. Negative bottom margin pulls the next row tight against
 * the label.
 *
 * Convention: title in uppercase short noun ("Revenue", "Pipeline", "Today",
 * "Commission", "Trends"). Optional caption gives one-line context.
 */
export function SectionHeader({
  title,
  caption,
  action,
}: {
  title: string
  caption?: string
  action?: React.ReactNode
}) {
  return (
    <div className="-mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {title}
        </h3>
        {caption && (
          <span className="text-[11px] text-[var(--color-muted-foreground)]">{caption}</span>
        )}
      </div>
      {action}
    </div>
  )
}
