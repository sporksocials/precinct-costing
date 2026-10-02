import { createClient } from "@supabase/supabase-js";
import { parseKitchenData, type KitchenData } from "./kitchen";

/**
 * Reads one venue's kitchen data through the public `cost_kitchen_data` function, with the anon key and no session:
 * the kitchen station has no login. Never cached, so a recipe edit shows on the iPad at its next refresh.
 * Null when the venue doesn't exist; throws when the database can't be reached.
 */
export async function fetchKitchenData(slug: string): Promise<KitchenData | null> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const { data, error } = await sb.rpc("cost_kitchen_data", { p_venue: slug });
  if (error) throw new Error(error.message);
  return parseKitchenData(data, new Date().toISOString());
}
