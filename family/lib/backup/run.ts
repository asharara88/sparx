import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/server/member";

/**
 * The nightly backup: every table the family would mind losing, as gzipped
 * JSON, in the private "backups" bucket, plus a list of the photos' paths.
 * Keeps the newest 8 runs. Photos themselves stay in the photos bucket
 * (Supabase keeps that); the manifest says what was there on each night.
 */

const TABLES = [
  "household", "roles", "modules", "permissions", "members", "presence", "work_schedules",
  "care_subjects", "care_entry_types", "care_entries", "care_custody", "attachments",
  "milk_bottles", "vaccinations", "medicines", "assistant_memories",
  "calendar_events", "shopping_items", "shopping_requests", "notes", "family_messages",
  "tickets", "ticket_updates", "assets", "contractors", "receipts", "receipt_lines", "purchases",
  "attendance", "bag_items", "ask_chats", "briefs", "audit_log",
] as const;
export const KEEP = 8;

async function all(db: SupabaseClient, table: string): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
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

export async function runBackup(db: SupabaseClient = serviceClient()): Promise<BackupReport> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const folder = `run-${stamp}`;
  const tables: Record<string, number> = {};
  let rows = 0;
  let size = 0;
  for (const t of TABLES) {
    const data = await all(db, t);
    if (data === null) continue;
    tables[t] = data.length;
    rows += data.length;
    const gz = gzipSync(Buffer.from(JSON.stringify(data)));
    size += gz.byteLength;
    const { error } = await db.storage.from("backups").upload(`${folder}/${t}.json.gz`, gz, { contentType: "application/gzip", upsert: true });
    if (error) throw new Error(`upload ${t}: ${error.message}`);
  }
  const photos = await listPhotos(db);
  const manifest = Buffer.from(JSON.stringify({ taken_at: new Date().toISOString(), tables, photos }));
  size += manifest.byteLength;
  const { error: mErr } = await db.storage.from("backups").upload(`${folder}/manifest.json`, manifest, { contentType: "application/json", upsert: true });
  if (mErr) throw new Error(`upload manifest: ${mErr.message}`);

  const { error: rowErr } = await db.from("backups").insert({ path: folder, size_bytes: size, rows, tables, photos: photos.length });
  if (rowErr) throw new Error(`record: ${rowErr.message}`);

  // Keep the newest KEEP runs.
  const { data: old } = await db.from("backups").select("id, path").order("created_at", { ascending: false }).range(KEEP, KEEP + 50);
  let removed = 0;
  for (const o of (old as { id: string; path: string }[] | null) ?? []) {
    const { data: files } = await db.storage.from("backups").list(o.path, { limit: 200 });
    if (files?.length) await db.storage.from("backups").remove(files.map((f) => `${o.path}/${f.name}`));
    await db.from("backups").delete().eq("id", o.id);
    removed += 1;
  }
  return { path: folder, rows, size, tables, photos: photos.length, removed };
}
