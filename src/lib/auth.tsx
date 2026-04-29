import * as React from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type { TeamRole } from "@/lib/database.types"

interface TeamProfile {
  id: string
  full_name: string
  email: string
  role: TeamRole
}

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: TeamProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [profile, setProfile] = React.useState<TeamProfile | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  React.useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    void loadProfile(session.user.id)
  }, [session?.user?.id])

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from("team_members")
      .select("id, full_name, email, role")
      .eq("user_id", userId)
      .maybeSingle()
    if (data) setProfile(data as TeamProfile)
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error?.message ?? null }
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
