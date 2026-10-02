import { createClient } from "@supabase/supabase-js";
import { parseBarMenu, type BarMenu } from "./bar";

/**
 * Reads one venue's bar menu through the public `cost_bar_menu` function, with the anon key and no session:
 * the cocktail station has no login. Never cached, so an edit in the app shows on the iPad at its next refresh.
 * Null when the venue doesn't exist; throws when the database can't be reached.
 */
export async function fetchBarMenu(slug: string): Promise<BarMenu | null> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const { data, error } = await sb.rpc("cost_bar_menu", { p_venue: slug });
  if (error) throw new Error(error.message);
  return parseBarMenu(data, new Date().toISOString());
}
