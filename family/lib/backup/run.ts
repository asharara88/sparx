import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/server/member";

/**
 * The nightly backup, one per home: every table the family would mind losing,
 * as gzipped JSON, in the private "backups" bucket under home-<id>/run-<stamp>,
 * plus a list of the home's photos' paths (its home-<id>/ folder; the first
 * home also owns the photos from before many homes). The definitions every home shares (roles,
 * modules, permissions, entry types) go in each home's run too, so a home's
 * folder restores on its own. Keeps the newest 8 runs per home. Photos
 * themselves stay in the photos bucket (Supabase keeps that); the manifest says
 * what was there on each night.
 */

const SHARED = ["roles", "modules", "permissions", "care_entry_types"] as const;
const HOME = [
  "members", "presence", "work_schedules",
  "care_subjects", "care_entries", "care_custody", "attachments",
  "milk_bottles", "vaccinations", "medicines", "assistant_memories",
  "calendar_events", "shopping_items", "shopping_requests", "notes", "family_messages",
  "tickets", "ticket_updates", "assets", "contractors", "receipts", "receipt_lines", "purchases",
  "attendance", "bag_items", "ask_chats", "assistant_briefs", "audit_log",
] as const;
export const KEEP = 8;

async function all(db: SupabaseClient, table: string, home: string | null): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select("*").range(from, from + 999);
    if (home) q = q.eq(table === "household" ? "id" : "household_id", home);
    const { data, error } = await q;
    if (error) {
      // A table that does not exist in this project (an older migration set) is skipped, not fatal.
      if (/does not exist|schema cache/i.test(error.message)) return null;
      throw new Error(`${table}: ${error.message}`);
    }
    out.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function listPhotos(db: SupabaseClient, prefix = ""): Promise<string[]> {
  const { data } = await db.storage.from("photos").list(prefix, { limit: 1000 });
  const paths: string[] = [];
  for (const f of data ?? []) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.id) paths.push(p);
    else paths.push(...(await listPhotos(db, p)));
  }
  return paths;
}

export interface BackupReport {
  path: string;
  rows: number;
  size: number;
  tables: Record<string, number>;
  photos: number;
  removed: number;
}

/** One home's backup. */
export async function backupHome(db: SupabaseClient, home: string, photos: string[], stamp: string): Promise<BackupReport> {
  const folder = `home-${home}/run-${stamp}`;
  const tables: Record<string, number> = {};
  let rows = 0;
  let size = 0;
  for (const t of ["household", ...HOME, ...SHARED]) {
    const data = await all(db, t, SHARED.includes(t as (typeof SHARED)[number]) ? null : home);
    if (data === null) continue;
    tables[t] = data.length;
    rows += data.length;
    const gz = gzipSync(Buffer.from(JSON.stringify(data)));
    size += gz.byteLength;
    const { error } = await db.storage.from("backups").upload(`${folder}/${t}.json.gz`, gz, { contentType: "application/gzip", upsert: true });
    if (error) throw new Error(`upload ${t}: ${error.message}`);
  }
  const manifest = Buffer.from(JSON.stringify({ taken_at: new Date().toISOString(), home, tables, photos }));
  size += manifest.byteLength;
  const { error: mErr } = await db.storage.from("backups").upload(`${folder}/manifest.json`, manifest, { contentType: "application/json", upsert: true });
  if (mErr) throw new Error(`upload manifest: ${mErr.message}`);

  const { error: rowErr } = await db.from("backups").insert({ household_id: home, path: folder, size_bytes: size, rows, tables, photos: photos.length });
  if (rowErr) throw new Error(`record: ${rowErr.message}`);

  // Keep the newest KEEP runs of this home.
  const { data: old } = await db.from("backups").select("id, path").eq("household_id", home).order("created_at", { ascending: false }).range(KEEP, KEEP + 50);
  let removed = 0;
  for (const o of (old as { id: string; path: string }[] | null) ?? []) {
    const { data: files } = await db.storage.from("backups").list(o.path, { limit: 200 });
    if (files?.length) await db.storage.from("backups").remove(files.map((f) => `${o.path}/${f.name}`));
    await db.from("backups").delete().eq("id", o.id);
    removed += 1;
  }
  return { path: folder, rows, size, tables, photos: photos.length, removed };
}

/** One home's backup now: what "Back up now" on the Audit screen runs, for the caller's home only. */
export async function runBackupFor(home: string, db: SupabaseClient = serviceClient()): Promise<BackupReport> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const { data, error } = await db.from("household").select("id").order("created_at");
  if (error) throw new Error(`homes: ${error.message}`);
  const ids = ((data as { id: string }[] | null) ?? []).map((h) => h.id);
  if (!ids.includes(home)) throw new Error("no such home");
  const all = await listPhotos(db);
  return backupHome(db, home, photosOf(all, home, ids[0]), stamp);
}

/** The photos a home owns: its own folder, and for the first home what was there before many homes. */
function photosOf(all: string[], home: string, first: string): string[] {
  return all.filter((p) => p.startsWith(`home-${home}/`) || (home === first && !p.startsWith("home-")));
}

/** Every home's backup, in one run: the nightly cron. The report sums them; `homes` has each. */
export async function runBackup(db: SupabaseClient = serviceClient()): Promise<BackupReport & { homes: Record<string, BackupReport> }> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const { data, error } = await db.from("household").select("id").order("created_at");
  if (error) throw new Error(`homes: ${error.message}`);
  const all = await listPhotos(db);
  const homes: Record<string, BackupReport> = {};
  const sum: BackupReport = { path: `run-${stamp}`, rows: 0, size: 0, tables: {}, photos: all.length, removed: 0 };
  const ids = ((data as { id: string }[] | null) ?? []).map((h) => h.id);
  for (const id of ids) {
    const r = await backupHome(db, id, photosOf(all, id, ids[0]), stamp);
    homes[id] = r;
    sum.rows += r.rows;
    sum.size += r.size;
    sum.removed += r.removed;
    for (const [t, n] of Object.entries(r.tables)) sum.tables[t] = (sum.tables[t] ?? 0) + n;
  }
  return { ...sum, homes };
}
