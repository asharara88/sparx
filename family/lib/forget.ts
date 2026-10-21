"use client";

/**
 * What a sign-out leaves behind on a shared phone, and should not: the pages the
 * service worker kept for offline opening (they were rendered for whoever was
 * signed in), and this tab's assistant chat. The offline queue stays: each entry
 * in it is stamped with its owner and only sends in that person's name.
 */
export async function forgetThisPhone(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* no cache storage here */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* no session storage here */
  }
}
