"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Member, Role } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

export function MemberForm({ member, roles, isSelf }: { member: Member | null; roles: Role[]; isSelf: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(member?.display_name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState(member?.role_id ?? roles[0]?.id ?? "");
  const [relationship, setRelationship] = useState(member?.relationship ?? "");
  const [birth, setBirth] = useState(member?.birth_date ?? "");
  const [active, setActive] = useState(member?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
    });
    setBusy(false);
    const res = data as { ok: boolean; id?: string; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg("Saved.");
    if (!member) router.push(`/members/${res.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Details</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">E-mail (used to sign in)</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        <span className="muted text-sm">They sign in with this e-mail. The link is sent to it.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Role</span>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
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
        <input className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Dana's mother" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Date of birth (optional)</span>
        <input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
      </label>
      {member && !isSelf && (
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-7 w-7" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-semibold">Active (can sign in)</span>
        </label>
      )}
      {msg && (
        <p role="status" className={`rounded-xl border-2 p-3 ${msg === "Saved." ? "border-green-700 text-green-800" : "border-red-700 text-red-800"}`}>
          {msg}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
