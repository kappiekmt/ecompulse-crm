import * as React from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

interface CopyableUrlProps {
  value: string
  className?: string
  label?: string
}

export function CopyableUrl({ value, className, label }: CopyableUrlProps) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2">
        <code className="flex-1 truncate font-mono text-xs text-[var(--color-foreground)]">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          className="rounded p-1 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}
