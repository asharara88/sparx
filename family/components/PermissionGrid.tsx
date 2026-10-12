"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Action, Module, Role } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

const ACTIONS: Action[] = ["view", "add", "edit", "delete"];

export function PermissionGrid({
  roles,
  modules,
  permissions,
  myRole,
}: {
  roles: Role[];
  modules: Module[];
  permissions: { role_id: string; module_id: string; action: string; allowed: boolean }[];
  myRole: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => {
    const m = new Map<string, boolean>();
    for (const p of permissions) m.set(`${p.role_id}|${p.module_id}|${p.action}`, p.allowed);
    return m;
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [newRole, setNewRole] = useState({ id: "", label: "" });

  async function toggle(role: string, module: string, action: Action) {
    const key = `${role}|${module}|${action}`;
    const next = !state.get(key);
    const { data, error } = await supabaseBrowser().rpc("permission_set", { p_role_id: role, p_module_id: module, p_action: action, p_allowed: next });
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(null);
    setState((s) => new Map(s).set(key, next));
  }

  async function addRole(e: React.FormEvent) {
    e.preventDefault();
    const id = newRole.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!id) return setMsg("Give the role a short name.");
    const { data, error } = await supabaseBrowser().rpc("role_save", { p_id: id, p_label: newRole.label || id, p_description: null });
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not add the role.");
    setNewRole({ id: "", label: "" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-3 text-red-800">
          {msg}
        </p>
      )}
      {roles.map((r) => (
        <section key={r.id} className="card overflow-x-auto">
          <h2 className="text-lg font-semibold">{r.label}</h2>
          {r.description && <p className="muted text-sm">{r.description}</p>}
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Module</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="capitalize">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id} className="border-t border-[var(--line)]">
                  <td className="py-1 pr-2 font-semibold">{m.label}</td>
                  {ACTIONS.map((a) => {
                    const on = !!state.get(`${r.id}|${m.id}|${a}`);
                    const locked = r.id === myRole && m.id === "members" && (a === "view" || a === "edit");
                    return (
                      <td key={a} className="text-center">
                        <button
                          type="button"
                          className="h-12 w-12 rounded-xl border-2 border-[var(--line)] text-xl"
                          style={on ? { background: "var(--accent)", color: "white", borderColor: "var(--accent)" } : undefined}
                          aria-pressed={on}
                          aria-label={`${r.label} ${a} ${m.label}`}
                          disabled={locked}
                          title={locked ? "Your own role keeps access to Members" : undefined}
                          onClick={() => toggle(r.id, m.id, a)}
                        >
                          {on ? <Icon name="check" size={18} /> : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <form onSubmit={addRole} className="card flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Add a role</h2>
        <input className="input" placeholder="Label, e.g. Night nurse" value={newRole.label} onChange={(e) => setNewRole({ ...newRole, label: e.target.value })} required />
        <input className="input" placeholder="Short id, e.g. night_nurse" value={newRole.id} onChange={(e) => setNewRole({ ...newRole, id: e.target.value })} required />
        <button className="btn" type="submit">
          Add role (nothing allowed until you tick it)
        </button>
      </form>
    </div>
  );
}
