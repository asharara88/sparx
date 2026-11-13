"use client";
import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { Member, Role } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/me-context";
import { childName } from "@/lib/names";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";

/**
 * A member's details. Save is the screen's one bottom button (DESIGN.md), so it is the last
 * thing on the page: `children` (the member's rows and their way in) sit between the details
 * card and it, outside the form, and the button reaches the form by its id.
 */
export function MemberForm({ member, roles, isSelf, children }: { member: Member | null; roles: Role[]; isSelf: boolean; children?: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const formId = useId();
  const [name, setName] = useState(member?.display_name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  // A new member starts with no role: Save would otherwise make the nanny an Admin.
  const [role, setRole] = useState(member?.role_id ?? "");
  const [relationship, setRelationship] = useState(member?.relationship ?? "");
  const [birth, setBirth] = useState(member?.birth_date ?? "");
  const [active, setActive] = useState(member?.is_active ?? true);
  const [breastfeeds, setBreastfeeds] = useState(member?.breastfeeds ?? false);
  const [routine, setRoutine] = useState(member?.routine ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return setMsg("Choose a role.");
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("member_save", {
      p_id: member?.id ?? null,
      p_display_name: name,
      p_email: email || null,
      p_role_id: role,
      p_birth_date: birth || null,
      p_relationship: relationship || null,
      p_is_active: active,
      p_routine: routine || null,
    });
    if (!error && (data as { ok: boolean })?.ok && member && breastfeeds !== member.breastfeeds) {
      await supabaseBrowser().from("members").update({ breastfeeds }).eq("id", member.id);
    }
    setBusy(false);
    const res = data as { ok: boolean; id?: string; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg("Saved.");
    // The note sits over the page by the button: it goes once read.
    setTimeout(() => setMsg((m) => (m === "Saved." ? null : m)), 4000);
    if (!member) router.push(`/members/${res.id}`);
    router.refresh();
  }

  return (
    <>
      <form id={formId} onSubmit={save} className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">E-mail (optional)</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
          <span className="muted text-sm">If they sign in with this address, they land here without a link.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf} required>
            {!role && (
              <option value="" disabled>
                Choose a role
              </option>
            )}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          {isSelf && <span className="muted text-sm">You cannot change your own role.</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Relationship</span>
          <input className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. the father's mother" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Date of birth (optional)</span>
          <input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Routine</span>
          <textarea className="input" rows={4} value={routine} onChange={(e) => setRoutine(e.target.value)} placeholder="e.g. Works 9 to 5 on weekdays, 30 minutes each way. Up at 7, out by 8:30. Pumps before leaving." />
          <span className="muted text-sm">Plain words. The helper reads it for “is Mama home?”, the morning brief and the weekly plan.</span>
        </label>
        {member && (
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={breastfeeds} onChange={(e) => setBreastfeeds(e.target.checked)} />
            <span className="min-w-0">
              <span className="block font-semibold">Breastfeeds {childName(me)}</span>
              <span className="muted block text-sm">Shows the breast timer and left or right.</span>
            </span>
          </label>
        )}
        {member && !isSelf && (
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="font-semibold">Active (can sign in)</span>
          </label>
        )}
      </form>
      {children}
      <div className="bottom-action flex flex-col gap-2">
        {msg && (
          <p role="status" className={`notice ${msg === "Saved." ? "notice-ok" : "notice-danger"}`}>
            {msg}
          </p>
        )}
        <button className="btn btn-primary btn-lg w-full" type="submit" form={formId} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

/**
 * A row on a member's page that opens its own sheet (DESIGN.md: a sheet for editing): the
 * label, one muted line saying what is set now, and ›. Goes in a `card flex flex-col p-0`
 * list. `children` is the sheet's content; a function gets the close, for a form that shuts
 * the sheet once it has saved.
 */
export function SheetRow({ label, hint, title, children }: { label: string; hint: string; title?: string; children: React.ReactNode | ((close: () => void) => React.ReactNode) }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <li className="row p-0">
      <button type="button" className="row-link flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => setOpen(true)}>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          <span className="muted block truncate text-sm">{hint}</span>
        </span>
        <Icon name="forward" size={18} className="muted shrink-0" />
      </button>
      {open && (
        <Sheet title={title ?? label} onClose={close}>
          {typeof children === "function" ? children(close) : children}
        </Sheet>
      )}
    </li>
  );
}
