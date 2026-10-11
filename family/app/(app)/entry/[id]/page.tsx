import { EntryEdit } from "@/components/EntryEdit";

export const dynamic = "force-dynamic";

/** Any care entry by id (the assistant's citations link here); EntryEdit works out whose it is. */
export default async function AnyEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryEdit id={id} fallback="/" />;
}
