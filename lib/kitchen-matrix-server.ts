import { createClient } from "@supabase/supabase-js";
import { parseKitchenMatrix, type KitchenMatrixData } from "./kitchen-matrix";

/**
 * Reads one venue's Allergy Matrix through the public `cost_kitchen_matrix` function, with the anon key and no session: the
 * kitchen station has no login. Never cached, so a sign-off or a recipe edit shows on the iPad at its next refresh.
 * Null when the venue does not exist; throws when the database can't be reached.
 */
export async function fetchKitchenMatrix(slug: string): Promise<KitchenMatrixData | null> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const { data, error } = await sb.rpc("cost_kitchen_matrix", { p_venue: slug });
  if (error) throw new Error(error.message);
  return parseKitchenMatrix(data, new Date().toISOString());
}
