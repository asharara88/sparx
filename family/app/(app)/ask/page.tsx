import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { can } from "@/lib/types";
import { Assistant } from "@/components/Assistant";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const supabase = await createClient();
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
  if (can(me, "lana", "view")) s.push("When did Lana last feed?", "How did Lana sleep last night?");
  if (can(me, "fanta", "view")) s.push("What's due for Fanta?");
  if (can(me, "calendar", "view")) s.push("Who's home on Thursday?", "What's on tomorrow?");
  if (can(me, "shopping", "view") || can(me, "shopping_requests", "add")) s.push("What's running low?");
  if (can(me, "maintenance", "view")) s.push("Is anything broken?");
  if (can(me, "assistant", "add") && can(me, "lana", "add")) s.push("Log a 120 ml bottle now");
  if (can(me, "assistant", "add") && can(me, "fanta", "add")) s.push("Fanta was fed 30 g");
  return <Assistant suggestions={s} />;
}
