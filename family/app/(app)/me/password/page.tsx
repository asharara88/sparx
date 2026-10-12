import Link from "next/link";
import { PasswordForm } from "@/components/PasswordForm";

export const dynamic = "force-dynamic";

/** Reached from Me → Change password, and from the "forgot password" e-mail link. */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/me" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">Password</h1>
      </header>
      <PasswordForm afterReset={reset === "1"} />
    </div>
  );
}
