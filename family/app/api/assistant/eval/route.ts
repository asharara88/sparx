import { NextResponse } from "next/server";
import type { Me, RpcError } from "@/lib/types";
import { CASES, grade } from "@/lib/assistant/evals";
import { toLocalInput } from "@/lib/time";
import { askAssistant } from "@/lib/assistant/run";
import { cronAuthorized, memberClient, serviceClient } from "@/lib/server/member";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { from?, n?, ids? } with the cron secret: runs eval cases as the members
 * they name (a short-lived JWT per member, so RLS applies exactly as in the
 * app) and grades each answer. Costs real model calls; run it on purpose, from
 * scripts/assistant-eval.mjs. Never on the schedule.
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 401 });
  let body: { from?: unknown; n?: unknown; ids?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* defaults */
  }
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : null;
  const from = Math.max(0, Number(body.from) || 0);
  const n = Math.min(10, Math.max(1, Number(body.n) || 5));
  const cases = (ids ? CASES.filter((c) => ids.includes(c.id)) : CASES).slice(from, from + n);

  let service;
  try {
    service = serviceClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "not_configured", message: e instanceof Error ? e.message : "no service key" }, { status: 503 });
  }
  const { data: members } = await service.from("members").select("display_name,user_id").eq("is_active", true);
  const userOf = new Map(((members as { display_name: string; user_id: string | null }[] | null) ?? []).map((m) => [m.display_name, m.user_id]));
  const clients = new Map<string, { supabase: Awaited<ReturnType<typeof memberClient>>; me: Me }>();

  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      let cl = clients.get(c.member);
      if (!cl) {
        const uid = userOf.get(c.member);
        if (!uid) throw new Error(`no signed-up member named ${c.member}`);
        const supabase = await memberClient(uid);
        const { data: meData } = await supabase.rpc("me");
        const me = meData as Me | RpcError | null;
        if (!me || !me.ok) throw new Error(`could not load ${c.member}`);
        cl = { supabase, me };
        clients.set(c.member, cl);
      }
      // For the end-timer case: what is really running right now, so the grade checks the id and the time.
      const asked_at = new Date().toISOString();
      let open_timers: string[] | undefined;
      if (c.expect.end_timer) {
        open_timers = [];
        for (const s of cl.me.subjects ?? []) {
          const { data } = await cl.supabase.rpc("home_summary", { p_subject_id: s.id });
          const ongoing = ((data as { ongoing?: { id?: string }[] } | null)?.ongoing ?? []).map((o) => o.id).filter((id): id is string => !!id);
          open_timers.push(...ongoing);
        }
      }
      const reply = await askAssistant({ supabase: cl.supabase, me: cl.me, turns: [], question: c.question, screen: c.screen ?? null });
      if (!reply.ok) {
        results.push({ id: c.id, pass: false, failures: [`${reply.error}: ${reply.message ?? ""}`], ms: Date.now() - t0 });
        continue;
      }
      const tz = cl.me.household.timezone;
      const run = {
        answer: reply.answer,
        skills: reply.skills.map((s) => s.id),
        tools: reply.tools,
        proposals: reply.proposals.map((p) => p.kind),
        care_entries: reply.proposals.filter((p) => p.care_entry).map((p) => ({ type_id: p.care_entry!.type_id, payload: p.care_entry!.payload, at: toLocalInput(p.care_entry!.occurred_at, tz).slice(11) })),
        end_timers: reply.proposals.filter((p) => p.end_timer).map((p) => ({ entry_id: p.end_timer!.entry_id, ended_at: p.end_timer!.ended_at })),
        open_timers,
        asked_at,
      };
      const g = grade(c, run);
      results.push({ id: c.id, member: c.member, pass: g.pass, failures: g.failures, answer: reply.answer, skills: run.skills, tools: run.tools, proposals: run.proposals, tokens: reply.usage.input_tokens + reply.usage.output_tokens, cache_read: reply.usage.cache_read, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ id: c.id, member: c.member, pass: false, failures: [e instanceof Error ? e.message : "failed"], ms: Date.now() - t0 });
    }
  }
  return NextResponse.json({ ok: true, total: ids ? cases.length : CASES.length, from, results });
}
