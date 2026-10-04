import { createClient } from "@supabase/supabase-js";
import { parseBarMenu, type BarMenu } from "./bar";
import { parseBarPremix, type BarPremix } from "./bar-premix";

/** Anon-key client, no session: the cocktail station has no login. Never cached, so an edit in the app shows on the iPad at its next refresh. */
function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

/**
 * Reads one venue's bar menu through the public `cost_bar_menu` function, with the anon key and no session:
 * the cocktail station has no login. Never cached, so an edit in the app shows on the iPad at its next refresh.
 * Null when the venue doesn't exist; throws when the database can't be reached.
 */
export async function fetchBarMenu(slug: string): Promise<BarMenu | null> {
  const { data, error } = await anonClient().rpc("cost_bar_menu", { p_venue: slug });
  if (error) throw new Error(error.message);
  return parseBarMenu(data, new Date().toISOString());
}

/** The same, for the Pre-Mix Bottles page: one venue's pre-mix bottles through `cost_bar_premix`. */
export async function fetchBarPremix(slug: string): Promise<BarPremix | null> {
  const { data, error } = await anonClient().rpc("cost_bar_premix", { p_venue: slug });
  if (error) throw new Error(error.message);
  return parseBarPremix(data, new Date().toISOString());
}
