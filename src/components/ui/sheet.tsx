import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SheetContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  React.useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onOpenChange])

  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetContext.Provider>
  )
}

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "right" | "left"
  width?: string
  children: React.ReactNode
}

export function SheetContent({
  className,
  side = "right",
  width = "640px",
  children,
  ...props
}: SheetContentProps) {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error("SheetContent must be inside Sheet")
  if (!ctx.open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => ctx.onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute top-0 bottom-0 flex flex-col overflow-hidden border-[var(--color-border)] bg-[var(--color-card)] shadow-xl",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className
        )}
        style={{ width: `min(${width}, 100vw)` }}
        {...props}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => ctx.onOpenChange(false)}
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)]"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-[var(--color-border)] px-6 py-4",
        className
      )}
      {...props}
    />
  )
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold tracking-tight", className)} {...props} />
}

export function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-[var(--color-muted-foreground)]", className)} {...props} />
  )
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5", className)} {...props} />
  )
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4",
        className
      )}
      {...props}
    />
  )
}
