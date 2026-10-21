/**
 * A promise with a deadline and a stop button. Used around every tool the
 * helper runs: a tool that hangs fails on its own after `ms`, and when the
 * member ends the conversation (the request's signal aborts) the wait stops at
 * once instead of running the clock out. The underlying work is not killed
 * here (a database call finishes on its own); the loop just stops waiting for
 * it, and the RPC helper passes the same signal down so the call is cut short
 * where the client supports it.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`${what} took too long`));
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** The error a stopped wait rejects with; `isAbort` recognises it, and the SDK's own. */
export function abortError(): Error {
  const e = new Error("stopped");
  e.name = "AbortError";
  return e;
}

export function isAbort(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = (e as { name?: unknown })?.name;
  return name === "AbortError" || name === "APIUserAbortError";
}
