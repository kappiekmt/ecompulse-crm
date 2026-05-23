import * as React from "react"

/**
 * Page header used at the top of every page. Pass `actions` for header buttons.
 *
 * **Button convention** (apply everywhere — page headers, dialog footers, card
 * actions; the rest of the app already follows it):
 *  - **Order:** secondary/utility/back actions go LEFT, the primary action goes
 *    RIGHTMOST. (E.g. dialog footers: "Cancel" left, "Save" right.)
 *  - **Variants:** `default` for the primary action, `outline` for secondary or
 *    "back" actions, `ghost` for tertiary / inline tests, `destructive` for
 *    delete/revoke. Don't invent variants.
 *  - **Sizes:** default size in page headers; `size="sm"` for inline list/card
 *    actions and dialog footers.
 *  - **Icons:** `h-4 w-4` Lucide icon before the label; swap to a spinning
 *    `<Loader2 className="h-4 w-4 animate-spin" />` while the action is pending.
 *  - **Labels:** verbs in title case, parallel structure for paired actions
 *    (e.g. "Send EOD" + "Send EOW", not "Send Team EOD" + "Send Weekly").
 */
interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-8 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
