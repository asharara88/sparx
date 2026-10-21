import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Remove every object under a folder of a bucket. Storage lists one level at a
 * time and tells a folder from a file by the missing id, so the folder is walked
 * first and the files removed in batches. Returns how many files went.
 */
export async function removeFolder(client: SupabaseClient, bucket: string, folder: string): Promise<number> {
  const paths = await listAll(client, bucket, folder);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) throw new Error(error.message);
    removed += batch.length;
  }
  return removed;
}

async function listAll(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const page = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: page, offset });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id) out.push(path);
      else out.push(...(await listAll(client, bucket, path)));
    }
    if (data.length < page) break;
    offset += data.length;
  }
  return out;
}
