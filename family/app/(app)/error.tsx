"use client";
import { useEffect } from "react";

/**
 * A screen crashed. Say so instead of going blank. The reason goes to the console (and
 * Vercel's logs by its digest), not to the screen: a raw error can carry internals, and
 * a grandmother cannot act on it anyway.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md p-6 pt-16">
      <div className="card flex flex-col gap-3">
        <h1 className="text-xl font-bold">Something went wrong on this screen</h1>
        <p className="muted break-words text-sm">
          Try again, or go Home. If it keeps happening, tell an admin{error.digest ? ` and mention ref ${error.digest}` : ""}.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <a href="/" className="btn">
            Home
          </a>
          <a href="/me" className="btn">
            Me
          </a>
        </div>
      </div>
    </div>
  );
}
