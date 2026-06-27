// Connectivity probe: insert a row into episodes and read it back.
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
if (!url || !key) { console.error('missing SUPABASE_URL or key'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const id = `probe_${Date.now()}`;
const ins = await sb.from('episodes').insert({ episode_id: id, status: 'draft', niche: 'connectivity-test' });
if (ins.error) { console.error('INSERT failed:', ins.error.message); process.exit(2); }
const sel = await sb.from('episodes').select('episode_id,status,niche').eq('episode_id', id).maybeSingle();
if (sel.error) { console.error('SELECT failed:', sel.error.message); process.exit(3); }
console.log('OK connected. Read back row:', JSON.stringify(sel.data));
await sb.from('episodes').delete().eq('episode_id', id);
console.log('cleanup done');
