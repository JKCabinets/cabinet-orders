"use client";

/**
 * Realtime client.
 *
 * Wraps the @supabase/supabase-js client with our minted JWT (from
 * /api/realtime-token). Handles token refresh ~5 minutes before expiry.
 *
 * Usage:
 *   const client = await getRealtimeClient();
 *   const channel = client.channel("...").on(...).subscribe();
 *
 * Tear down at app shutdown (rare):
 *   teardownRealtimeClient();
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let currentToken: string | null = null;
let currentExpiresAt: number | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let client: SupabaseClient | null = null;

async function fetchToken(): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch("/api/realtime-token", { method: "POST" });
  if (!res.ok) {
    throw new Error(
      `[realtime] token fetch failed: HTTP ${res.status}`,
    );
  }
  const data = await res.json();
  if (typeof data.token !== "string" || typeof data.expiresAt !== "number") {
    throw new Error("[realtime] token response missing fields");
  }
  return data;
}

function scheduleRefresh(expiresAt: number) {
  if (refreshTimer) clearTimeout(refreshTimer);

  // Refresh 5 minutes before the token expires. If less than 5 min left,
  // refresh immediately on next tick.
  const refreshAt = expiresAt - 5 * 60 * 1000;
  const delay = Math.max(0, refreshAt - Date.now());

  refreshTimer = setTimeout(async () => {
    try {
      const { token, expiresAt: nextExp } = await fetchToken();
      currentToken = token;
      currentExpiresAt = nextExp;
      scheduleRefresh(nextExp);
    } catch (err) {
      // Refresh failed. The next time a Supabase client request needs a
      // token, the `accessToken` callback will return the stale one and
      // Supabase will respond with an auth error. The channel will drop;
      // the next page navigation will re-init the client with a fresh
      // token if the user's session is still valid.
      console.warn("[realtime] token refresh failed; will retry on next page load", err);
    }
  }, delay);
}

/**
 * Returns a singleton Supabase client configured with our auth token.
 * Lazily initializes on first call. Safe to call from multiple places —
 * they all share the same client and the same token refresh timer.
 */
export async function getRealtimeClient(): Promise<SupabaseClient> {
  if (!currentToken || !currentExpiresAt) {
    const { token, expiresAt } = await fetchToken();
    currentToken = token;
    currentExpiresAt = expiresAt;
    scheduleRefresh(expiresAt);
  }

  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "[realtime] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing at build time",
      );
    }

    client = createClient(url, anonKey, {
      // The accessToken callback runs whenever Supabase needs to send an
      // auth header. By returning our minted JWT, all client requests
      // (including the WebSocket handshake for Realtime) are auth'd as
      // the logged-in user with our custom claims.
      accessToken: async () => currentToken!,
      auth: {
        // We are NOT using Supabase Auth — NextAuth is our session layer.
        // Disable Supabase's own auth machinery (token storage, refresh
        // attempts, etc.) so it doesn't conflict with our minted JWT.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

/**
 * Tear down. Mainly useful in tests; in production we typically keep
 * the client alive for the lifetime of the tab.
 */
export function teardownRealtimeClient(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    void client.removeAllChannels();
    client = null;
  }
  currentToken = null;
  currentExpiresAt = null;
}
