import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, MemoryData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MemoryList, type AboutOption } from "@/components/MemoryList";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "assistant", "view")) redirect("/");
  const [{ data }, { data: members }] = await Promise.all([supabase.rpc("memory_list"), supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name")]);
  const mem = data as MemoryData | RpcError | null;
  const about: AboutOption[] = [
    { key: "home", label: "The home", kind: "home", id: null },
    ...(me.subjects ?? []).filter((s) => s.kind === "child").map((s) => ({ key: `s:${s.id}`, label: s.name, kind: "child" as const, id: s.id })),
    ...(((members as { id: string; display_name: string }[] | null) ?? []).map((m) => ({ key: `m:${m.id}`, label: m.display_name, kind: "person" as const, id: m.id }))),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/ask" title="What the helper remembers" subtitle="Short facts about the home, the child and each of you. The ones that matter go into every answer." />
      <MemoryList items={mem && mem.ok ? mem.items : []} timezone={me.household.timezone} about={about} />
    </div>
  );
}
