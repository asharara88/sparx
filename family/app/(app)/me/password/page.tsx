import Link from "next/link";
import { PasswordForm } from "@/components/PasswordForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/** Reached from Me → Change password, and from the "forgot password" e-mail link. */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Password" />
      <PasswordForm afterReset={reset === "1"} />
    </div>
  );
}
