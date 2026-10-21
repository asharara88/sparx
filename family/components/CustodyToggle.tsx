"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { childName } from "@/lib/names";

/** "Who has the child" — one tap to open, one tap to choose. */
export function CustodyToggle({
  subjectId,
  custody,
}: {
  subjectId: string;
  custody: { member_id: string; name: string | null } | null;
}) {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const allowed = can(me, "lana", "add");

  useEffect(() => {
    if (!open) return;
    supabaseBrowser()
      .from("members")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name")
      .then(({ data }: { data: { id: string; display_name: string }[] | null }) => setMembers(data ?? []));
  }, [open]);

  async function choose(memberId: string) {
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("custody_set", { p_subject_id: subjectId, p_member_id: memberId });
    setBusy(false);
    setOpen(false);
    if ((data as { ok: boolean })?.ok) router.refresh();
  }

  const name = childName(me);
  const label = custody?.name ? `With ${custody.member_id === me.member.id ? "me" : custody.name}` : `Who has ${name}?`;
  if (!allowed) return <span className="chip">{label}</span>;

  return (
    <div className="relative">
      <button className="chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-2 shadow-lg">
          <p className="muted px-2 py-1 text-sm">Who has {name} now?</p>
          {members.length === 0 && <p className="px-2 py-2">Loading…</p>}
          {members.map((m) => (
            <button
              key={m.id}
              className="btn my-1 w-full justify-start"
              disabled={busy}
              aria-pressed={custody?.member_id === m.id}
              onClick={() => choose(m.id)}
            >
              {m.id === me.member.id ? `Me (${m.display_name})` : m.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
