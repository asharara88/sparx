import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ChatData, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { FamilyChat } from "@/components/FamilyChat";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "chat", "view")) redirect("/");
  const { data } = await supabase.rpc("chat_list", { p_limit: 150 });
  const chat = data as ChatData | RpcError;
  return (
    <div className="flex h-[calc(100dvh-var(--tabbar-h))] flex-col gap-3">
      <PageHeader
        title="Family chat"
        subtitle="Everyone at home sees these."
        action={
          can(me, "assistant", "view") ? (
            <Link href="/ask" className="btn btn-secondary">
              <Icon name="sparkles" size={18} /> Ask
            </Link>
          ) : undefined
        }
      />
      <FamilyChat initial={chat.ok ? chat.messages : []} timezone={me.household.timezone} canPost={can(me, "chat", "add")} />
    </div>
  );
}
