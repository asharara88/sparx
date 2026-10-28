import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * me(), asked once per request: the (app) layout and the page both need it, and each
 * question to the database is a round trip. React's cache shares the one answer.
 */
export const meOnce = cache(async () => {
  const supabase = await createClient();
  return supabase.rpc("me");
});
