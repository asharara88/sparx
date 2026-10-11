import { EntryEdit } from "@/components/EntryEdit";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryEdit id={id} fallback="/lana" />;
}
