import type { HubEntity, HubState } from "@/lib/types";

/**
 * Home Assistant, read-only. The app shows states and camera stills; it never
 * calls a service. URL and token live on the server only.
 */
export function hubConfigured(): boolean {
  return !!(process.env.HOME_ASSISTANT_URL && process.env.HOME_ASSISTANT_TOKEN);
}

function base(): string {
  return (process.env.HOME_ASSISTANT_URL ?? "").replace(/\/+$/, "");
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.HOME_ASSISTANT_TOKEN}`, "content-type": "application/json" };
}

interface RawState {
  entity_id: string;
  state: string;
  last_changed?: string;
  attributes?: Record<string, unknown>;
}

/** States for the configured entities (or every entity when `all` is set, for the settings screen). */
export async function hubStates(entities: HubEntity[], all = false): Promise<HubState[]> {
  const res = await fetch(`${base()}/api/states`, { headers: headers(), signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
  const raw = (await res.json()) as RawState[];
  const byId = new Map(entities.map((e) => [e.entity_id, e]));
  const rows = all ? raw : raw.filter((r) => byId.has(r.entity_id));
  return rows
    .map((r) => {
      const cfg = byId.get(r.entity_id);
      const domain = r.entity_id.split(".")[0];
      const kind: HubState["kind"] = cfg?.kind ?? (domain === "camera" ? "camera" : domain === "binary_sensor" ? "binary" : domain === "sensor" ? "sensor" : "other");
      return {
        entity_id: r.entity_id,
        label: cfg?.label ?? (typeof r.attributes?.friendly_name === "string" ? (r.attributes.friendly_name as string) : r.entity_id),
        kind,
        state: r.state,
        unit: typeof r.attributes?.unit_of_measurement === "string" ? (r.attributes.unit_of_measurement as string) : null,
        last_changed: r.last_changed ?? null,
        ...(all ? {} : { attributes: undefined }),
      };
    })
    .sort((a, b) => (byId.get(a.entity_id)?.sort ?? 999) - (byId.get(b.entity_id)?.sort ?? 999) || a.label.localeCompare(b.label));
}

/** A still from a camera entity, as bytes. */
export async function hubCamera(entityId: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  const res = await fetch(`${base()}/api/camera_proxy/${encodeURIComponent(entityId)}`, { headers: { Authorization: `Bearer ${process.env.HOME_ASSISTANT_TOKEN}` }, signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
  return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "image/jpeg" };
}
