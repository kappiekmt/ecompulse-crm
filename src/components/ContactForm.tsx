import * as React from "react"
import { Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface ContactFields {
  full_name: string
  email: string | null
  phone: string | null
  instagram: string | null
}

interface Props {
  contact: ContactFields
  /** Receives a patch with only the changed fields. */
  onSave: (patch: Partial<ContactFields>) => Promise<void> | void
  saving?: boolean
}

/**
 * 2x2 contact field grid that buffers changes locally and only shows a
 * Save button when something's actually been edited. Reset undoes the
 * draft. Used in the Lead drawer + the Student drawer (both write to the
 * same `leads` row underneath).
 */
export function ContactForm({ contact, onSave, saving }: Props) {
  const [name, setName] = React.useState(contact.full_name)
  const [email, setEmail] = React.useState(contact.email ?? "")
  const [phone, setPhone] = React.useState(contact.phone ?? "")
  const [insta, setInsta] = React.useState(contact.instagram ?? "")

  // Re-sync local state if the underlying record changes (e.g. another
  // tab updated it, or the drawer was reopened on a different lead).
  React.useEffect(() => {
    setName(contact.full_name)
    setEmail(contact.email ?? "")
    setPhone(contact.phone ?? "")
    setInsta(contact.instagram ?? "")
  }, [contact.full_name, contact.email, contact.phone, contact.instagram])

  const trimName = name.trim()
  const trimEmail = email.trim()
  const trimPhone = phone.trim()
  const trimInsta = insta.trim()

  const dirty =
    trimName !== contact.full_name ||
    (trimEmail || null) !== contact.email ||
    (trimPhone || null) !== contact.phone ||
    (trimInsta || null) !== contact.instagram

  // Name is required — empty name disables save (otherwise we'd null
  // out the lead's display label).
  const canSave = dirty && trimName.length > 0

  function reset() {
    setName(contact.full_name)
    setEmail(contact.email ?? "")
    setPhone(contact.phone ?? "")
    setInsta(contact.instagram ?? "")
  }

  async function save() {
    if (!canSave) return
    const patch: Partial<ContactFields> = {}
    if (trimName !== contact.full_name) patch.full_name = trimName
    if ((trimEmail || null) !== contact.email) patch.email = trimEmail || null
    if ((trimPhone || null) !== contact.phone) patch.phone = trimPhone || null
    if ((trimInsta || null) !== contact.instagram) patch.instagram = trimInsta || null
    await onSave(patch)
  }

  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") save()
    else if (e.key === "Escape") reset()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field
          label="Full name"
          value={name}
          onChange={setName}
          onKeyDown={onEnter}
          placeholder="Required"
        />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          onKeyDown={onEnter}
          placeholder="—"
          type="email"
        />
        <Field
          label="Phone"
          value={phone}
          onChange={setPhone}
          onKeyDown={onEnter}
          placeholder="—"
        />
        <Field
          label="Instagram"
          value={insta}
          onChange={setInsta}
          onKeyDown={onEnter}
          placeholder="—"
        />
      </div>

      {dirty && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={saving}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  onKeyDown,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  type?: "text" | "email"
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </label>
  )
}
