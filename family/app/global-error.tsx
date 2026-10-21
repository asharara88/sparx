"use client";

/** The root layout itself failed. Plain HTML, no app styles to depend on. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, background: "#f4f4f7", color: "#111" }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p style={{ color: "#555", wordBreak: "break-word" }}>
          Try again. If it keeps happening, tell an admin{error.digest ? ` and mention ref ${error.digest}` : ""}.
        </p>
        <button type="button" onClick={() => reset()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #ccc", background: "#fff" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
