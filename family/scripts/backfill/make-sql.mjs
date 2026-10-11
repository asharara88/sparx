#!/usr/bin/env node
/** data/lana-entries.json -> data/sql/backfill-NN.sql, compact and idempotent (client_id = md5 of type|time|n). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const es = JSON.parse(readFileSync("data/lana-entries.json", "utf8"));
const T = { feed: "f", diaper: "d", sleep: "s", wake: "w", pump: "p", routine: "r", note: "n", growth: "g", milestone: "m", medication: "x", appointment: "a" };
const A = { "00000000-0000-4000-8000-000000000001": "m", "00000000-0000-4000-8000-000000000002": "d", "00000000-0000-4000-8000-000000000003": "w", "00000000-0000-4000-8000-000000000004": "l", "00000000-0000-4000-8000-000000000005": "y" };
const base = Date.parse("2026-06-01T00:00:00+04:00");
const mins = (iso) => Math.round((Date.parse(iso) - base) / 60000);
const seen = new Map();
const rows = es.map((e) => {
  const key = `${e.type_id}|${e.occurred_at}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  return [T[e.type_id.slice(5)], mins(e.occurred_at), e.ended_at ? mins(e.ended_at) : null, Object.keys(e.payload).length ? e.payload : null, e.note, e.attributed_to ? A[e.attributed_to] : null, n];
});
const head = `with t(c, id) as (values ('f','lana.feed'),('d','lana.diaper'),('s','lana.sleep'),('w','lana.wake'),('p','lana.pump'),('r','lana.routine'),('n','lana.note'),('g','lana.growth'),('m','lana.milestone'),('x','lana.medication'),('a','lana.appointment')),
m(c, id) as (values ('m','00000000-0000-4000-8000-000000000001'::uuid),('d','00000000-0000-4000-8000-000000000002'),('w','00000000-0000-4000-8000-000000000003'),('l','00000000-0000-4000-8000-000000000004'),('y','00000000-0000-4000-8000-000000000005')),
r as (select t.id as type_id,
             timestamptz '2026-06-01 00:00+04' + ((v->>1)::int || ' minutes')::interval as o,
             case when v->>2 is null then null else timestamptz '2026-06-01 00:00+04' + ((v->>2)::int || ' minutes')::interval end as e,
             coalesce(v->3, '{}'::jsonb) as p, v->>4 as n, m.id as a, (v->>6) as k
        from jsonb_array_elements($j$`;
const tail = `$j$::jsonb) v join t on t.c = v->>0 left join m on m.c = v->>5)
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, ended_at, payload, note, logged_by, attributed_to)
select md5('lana-backfill|' || type_id || '|' || o::text || '|' || k)::uuid, '00000000-0000-4000-8000-00000000a001', 'lana', type_id, o, e, p, n, '00000000-0000-4000-8000-000000000002', a from r
on conflict (client_id) do update set ended_at = excluded.ended_at, payload = excluded.payload, note = excluded.note, attributed_to = excluded.attributed_to, deleted_at = null;`;
const chunks = []; let cur = [];
for (const r of rows) { cur.push(r); if (JSON.stringify(cur).length > 44000) { chunks.push(cur); cur = []; } }
if (cur.length) chunks.push(cur);
mkdirSync("data/sql", { recursive: true });
chunks.forEach((c, i) => writeFileSync(`data/sql/backfill-${String(i + 1).padStart(2, "0")}.sql`, head + JSON.stringify(c) + tail));
console.log("chunks", chunks.length, "rows", rows.length, "bytes", chunks.reduce((n, c) => n + JSON.stringify(c).length, 0));
