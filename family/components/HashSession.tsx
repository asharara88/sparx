"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * When Supabase cannot use our callback URL (for example a redirect URL that is not on its
 * allow-list), it sends the person to the Site URL with the session in the URL hash:
 * #access_token=…&refresh_token=…&type=recovery. The server never sees a hash, so this
 * picks it up in the browser, stores the session in cookies, and sends them on.
 */
export function HashSession() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");
    if (!access_token || !refresh_token) return;
    (async () => {
      const { error } = await supabaseBrowser().auth.setSession({ access_token, refresh_token });
      if (error) return;
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(type === "recovery" ? "/me/password?reset=1" : "/");
      router.refresh();
    })();
  }, [router]);
  return null;
}
