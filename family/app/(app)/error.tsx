"use client";
import { useEffect } from "react";

/** A screen crashed. Say so, with the reason, instead of going blank. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md p-6 pt-16">
      <div className="card flex flex-col gap-3">
        <h1 className="text-xl font-bold">Something went wrong on this screen</h1>
        <p className="muted break-words text-sm">
          {error.message || "No details."}
          {error.digest ? ` (ref ${error.digest})` : ""}
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
