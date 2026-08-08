import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireSupabasePublicConfig, requireSupabaseSecretKey } from "@/lib/supabase/config";

export async function createSupabaseServerClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; src/proxy.ts refreshes them.
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const { url } = requireSupabasePublicConfig();
  return createClient(url, requireSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createSupabaseBearerClient(accessToken: string) {
  const { url, publishableKey } = requireSupabasePublicConfig();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { authorization: `Bearer ${accessToken}` } },
  });
}
