import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/layout/Sidebar"

export function AppLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-background)]">
        <Outlet />
      </main>
    </div>
  )
}
