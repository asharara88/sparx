import { createClient } from "@/lib/supabase/server";
import type { AskChat, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { childName } from "@/lib/names";
import { Assistant } from "@/components/Assistant";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; say?: string; from?: string }> }) {
  const supabase = await createClient();
  const { c, q, say, from } = await searchParams;
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "assistant", "view")) {
    return (
      <div className="card mt-4">
        <h1 className="page-title">Ask</h1>
        <p className="mt-2">The assistant is not switched on for your role. Ask an admin.</p>
      </div>
    );
  }
  const child = childName(me);
  const s: string[] = [];
  if (q && q.trim()) s.push(q.trim().slice(0, 200));
  if (can(me, "lana", "view")) s.push(`When did ${child} last feed?`, `How did ${child} sleep last night?`);
  if (can(me, "calendar", "view")) s.push("Who's home on Thursday?", "What's on tomorrow?");
  if (can(me, "assistant", "add") && can(me, "lana", "add")) s.push("Log a 120 ml bottle now");
  const [{ data: chatRows }, { data: current }] = await Promise.all([
    supabase.from("ask_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(30),
    c && /^[0-9a-f-]{36}$/.test(c) ? supabase.from("ask_chats").select("*").eq("id", c).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return <Assistant key={c ?? say ?? "new"} suggestions={s} chats={(chatRows as Pick<AskChat, "id" | "title" | "updated_at">[] | null) ?? []} initial={(current as AskChat | null) ?? null} autoAsk={say?.trim().slice(0, 300) || null} screen={from?.trim().slice(0, 20) || null} />;
}
