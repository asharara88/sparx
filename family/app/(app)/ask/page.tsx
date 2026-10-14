import { createClient } from "@/lib/supabase/server";
import type { AskChat, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { Assistant } from "@/components/Assistant";

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; say?: string }> }) {
  const supabase = await createClient();
  const { c, q, say } = await searchParams;
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "assistant", "view")) {
    return (
      <div className="card mt-4">
        <h1 className="page-title">Ask</h1>
        <p className="mt-2">The assistant is not switched on for your role. Ask Mido or Dana.</p>
      </div>
    );
  }
  const s: string[] = [];
  if (q && q.trim()) s.push(q.trim().slice(0, 200));
  if (can(me, "lana", "view")) s.push("When did Lana last feed?", "How did Lana sleep last night?");
  if (can(me, "fanta", "view")) s.push("What's due for Fanta?");
  if (can(me, "calendar", "view")) s.push("Who's home on Thursday?", "What's on tomorrow?");
  if (can(me, "shopping", "view") || can(me, "shopping_requests", "add")) s.push("What's running low?");
  if (can(me, "maintenance", "view")) s.push("Is anything broken?");
  if (can(me, "assistant", "add") && can(me, "lana", "add")) s.push("Log a 120 ml bottle now");
  if (can(me, "assistant", "add") && can(me, "fanta", "add")) s.push("Fanta was fed 30 g");
  const [{ data: chatRows }, { data: current }] = await Promise.all([
    supabase.from("ask_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(30),
    c && /^[0-9a-f-]{36}$/.test(c) ? supabase.from("ask_chats").select("*").eq("id", c).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return <Assistant key={c ?? say ?? "new"} suggestions={s} chats={(chatRows as Pick<AskChat, "id" | "title" | "updated_at">[] | null) ?? []} initial={(current as AskChat | null) ?? null} autoAsk={say?.trim().slice(0, 300) || null} />;
}
