import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/supabase"
import { AppLayout } from "@/components/layout/AppLayout"
import { Dashboard } from "@/pages/Dashboard"
import { CommandCenter } from "@/pages/CommandCenter"
import { Pipeline } from "@/pages/Pipeline"
import { Leads } from "@/pages/Leads"
import { Directory } from "@/pages/Directory"
import { Students } from "@/pages/Students"
import { Finance } from "@/pages/Finance"
import { Reports } from "@/pages/Reports"
import { Automations } from "@/pages/Automations"
import { Team } from "@/pages/Team"
import { ImportLeads } from "@/pages/ImportLeads"
import { ImportPayments } from "@/pages/ImportPayments"
import { LeadTags } from "@/pages/LeadTags"
import { Integrations } from "@/pages/Integrations"
import { Help } from "@/pages/Help"
import { SignIn } from "@/pages/SignIn"
import { SetPassword } from "@/pages/SetPassword"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

function ProtectedRoutes() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        Loading…
      </div>
    )
  }

  if (isSupabaseConfigured && !session) {
    return <Navigate to="/sign-in" replace />
  }

  return <AppLayout />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route element={<ProtectedRoutes />}>
              <Route index element={<Dashboard />} />
              <Route path="command-center" element={<CommandCenter />} />
              <Route path="leads" element={<Leads />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="directory" element={<Directory />} />
              <Route path="students" element={<Students />} />
              <Route path="finance" element={<Finance />} />
              <Route path="reports" element={<Reports />} />
              <Route path="automations" element={<Automations />} />
              <Route path="team" element={<Team />} />
              <Route path="import-leads" element={<ImportLeads />} />
              <Route path="import-payments" element={<ImportPayments />} />
              <Route path="lead-tags" element={<LeadTags />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
