import * as React from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

/**
 * Lands here when a newly-invited team member clicks the magic link in their
 * invite email. Supabase parses the access_token from the URL hash and creates
 * a session automatically (detectSessionInUrl: true). At this point the user
 * is signed in but doesn't have a password yet — we collect one and call
 * supabase.auth.updateUser({ password }), then drop them into the dashboard.
 *
 * Also doubles as the password-recovery / password-change destination if we
 * ever expose a "Forgot password" flow.
 */
export function SetPassword() {
  const { session, loading, profile } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  if (!isSupabaseConfigured) {
    return <Navigate to="/" replace />
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-muted)] p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Invite link expired or invalid</CardTitle>
            <CardDescription>
              The magic link in the invite is no longer valid. Ask an admin to send you a fresh
              invite, then click the link in that email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/sign-in")}>
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(true)
    setTimeout(() => navigate("/", { replace: true }), 1200)
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-muted)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)]">
            EP
          </div>
          <CardTitle>
            Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""} 👋
          </CardTitle>
          <CardDescription>
            Set a password for your EcomPulse CRM account. After this you'll be signed in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <p className="text-sm text-[var(--color-success)]">
              ✓ Password set. Taking you to the dashboard…
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw">New password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Set password & continue
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
