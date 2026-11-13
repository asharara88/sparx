"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { Action, Module, Role } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";

const ACTIONS: { id: Action; label: string }[] = [
  { id: "view", label: "View" },
  { id: "add", label: "Add" },
  { id: "edit", label: "Edit" },
  { id: "delete", label: "Delete" },
];

/**
 * Roles and what each may do, as a list (DESIGN.md: a phone screen never has a table). A role
 * opens a sheet with a row per module: its name, then View · Add · Edit · Delete as four equal
 * toggles, which fit at 320 px. A toggle saves at once. "Add a role" is the screen's bottom
 * button and opens its own sheet. The page's flex column holds these directly (a fragment), so
 * the bottom button rests by the thumb on a short screen.
 */
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
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const closeRole = useCallback(() => {
    setOpenRole(null);
    setMsg(null);
  }, []);
  const closeAdd = useCallback(() => {
    setAdding(false);
    setMsg(null);
  }, []);

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
    setMsg(null);
    setAdding(false);
    // Straight on to what it may do: its sheet opens once the refreshed list has it.
    setOpenRole(id);
    router.refresh();
  }

  const role = openRole ? roles.find((r) => r.id === openRole) : undefined;
  const alert = msg ? (
    <p role="alert" className="notice notice-danger">
      {msg}
    </p>
  ) : null;

  return (
    <>
      {!role && !adding && alert}
      <ul className="card flex flex-col p-0" aria-label="Roles">
        {roles.map((r) => (
          <li key={r.id} className="row p-0">
            <button type="button" className="row-link flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => setOpenRole(r.id)}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.label}</span>
                {r.description && <span className="muted block truncate text-sm">{r.description}</span>}
              </span>
              <Icon name="forward" size={18} className="muted shrink-0" />
            </button>
          </li>
        ))}
      </ul>

      {role && (
        <Sheet title={role.label} onClose={closeRole}>
          {role.description && <p className="muted">{role.description}</p>}
          {alert}
          <ul className="card flex flex-col p-0" aria-label={`What ${role.label} may do`}>
            {modules.map((m) => {
              const mine = role.id === myRole && m.id === "members";
              return (
                <li key={m.id} className="row flex-col gap-2 px-4">
                  <span className="font-semibold">{m.label}</span>
                  <div className="grid grid-cols-4 gap-1" role="group" aria-label={m.label}>
                    {ACTIONS.map((a) => {
                      const on = !!state.get(`${role.id}|${m.id}|${a.id}`);
                      // An admin never locks themselves out of this screen.
                      const locked = mine && (a.id === "view" || a.id === "edit");
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className="chip px-0 text-sm"
                          aria-pressed={on}
                          aria-label={`${role.label}: ${a.label} ${m.label}`}
                          disabled={locked}
                          title={locked ? "Your own role keeps access to Members" : undefined}
                          onClick={() => toggle(role.id, m.id, a.id)}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                  {mine && <span className="muted text-sm">Your own role keeps View and Edit here.</span>}
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {adding && (
        <Sheet title="Add a role" onClose={closeAdd}>
          <form onSubmit={addRole} className="flex flex-col gap-3">
            <p className="muted">Nothing is allowed until you tick it.</p>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Name</span>
              <input className="input" placeholder="e.g. Night nurse" value={newRole.label} onChange={(e) => setNewRole({ ...newRole, label: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Short name, no spaces</span>
              <input className="input" placeholder="e.g. night_nurse" autoCapitalize="none" value={newRole.id} onChange={(e) => setNewRole({ ...newRole, id: e.target.value })} required />
            </label>
            {alert}
            <button className="btn btn-primary btn-lg w-full" type="submit">
              Add role
            </button>
          </form>
        </Sheet>
      )}

      <div className="bottom-action">
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} /> Add a role
        </button>
      </div>
    </>
  );
}
