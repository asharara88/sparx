import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, NotesData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { NotesBoard } from "@/components/NotesBoard";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "notes", "view")) redirect("/");
  const { data } = await supabase.rpc("notes_list", { p_limit: 200 });
  const notes = data as NotesData | RpcError;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Notes" subtitle="Short notes for the house. A note marked “just for me” is yours alone." />
      <NotesBoard notes={notes.ok ? notes.notes : []} />
    </div>
  );
}
