import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/supabase"
import { AppLayout } from "@/components/layout/AppLayout"
import { Dashboard } from "@/pages/Dashboard"
import { Pipeline } from "@/pages/Pipeline"
import { Leads } from "@/pages/Leads"
import { Students } from "@/pages/Students"
import { Finance } from "@/pages/Finance"
import { Reports } from "@/pages/Reports"
import { Automations } from "@/pages/Automations"
import { Team } from "@/pages/Team"
import { SignIn } from "@/pages/SignIn"

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

  // In preview mode (no Supabase) we let the user explore the UI.
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
            <Route element={<ProtectedRoutes />}>
              <Route index element={<Dashboard />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="leads" element={<Leads />} />
              <Route path="students" element={<Students />} />
              <Route path="finance" element={<Finance />} />
              <Route path="reports" element={<Reports />} />
              <Route path="automations" element={<Automations />} />
              <Route path="team" element={<Team />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
