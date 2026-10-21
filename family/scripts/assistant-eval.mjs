#!/usr/bin/env node
// Runs the helper's eval set against a running app and prints a table.
//   npm run eval:assistant                 (all cases, against http://localhost:3000)
//   npm run eval:assistant -- --ids teething,fever_young
//   EVAL_URL=https://elnunu.com npm run eval:assistant
// Needs CRON_SECRET in the environment (or .env.local); the server needs the
// service role key and JWT secret, as the cron does. Each case is one real
// model call, so it costs money: run it when a prompt or a skill changes.

const base = (process.env.EVAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(2);
}
const idsArg = process.argv.indexOf("--ids");
const ids = idsArg > 0 ? process.argv[idsArg + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;

const all = [];
let from = 0;
for (;;) {
  const res = await fetch(`${base}/api/assistant/eval`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify({ from, n: 5, ids }) });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  all.push(...data.results);
  for (const r of data.results) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.id.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${r.failures.join("; ")}`);
  from += 5;
  if (from >= data.total || data.results.length === 0) break;
}
const passed = all.filter((r) => r.pass).length;
console.log(`\n${passed}/${all.length} passed`);
for (const r of all.filter((r) => !r.pass)) {
  console.log(`\n--- ${r.id} (${r.member ?? ""})\nskills: ${(r.skills ?? []).join(", ")} | tools: ${(r.tools ?? []).join(", ")} | proposals: ${(r.proposals ?? []).join(", ")}\n${r.answer ?? ""}`);
}
process.exit(passed === all.length ? 0 : 1);
