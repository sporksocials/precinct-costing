"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-client";

let client: SupabaseClient | null = null;

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  // Demo mode (visual QA only): in-memory data, no network, no auth. Never set NEXT_PUBLIC_DEMO in production.
  if (DEMO) {
    client = createDemoClient();
    return client;
  }
  client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}
