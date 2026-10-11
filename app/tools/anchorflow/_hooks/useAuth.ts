"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session, User as AuthUser } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "../_lib/supabaseClient";

export type OAuthProvider = "google" | "github";

/** Extracts the account email from a session, or null when absent. */
export function userEmail(session: Session | null): string | null {
  const user: AuthUser | null = session?.user ?? null;
  return user?.email ?? null;
}

function stripOAuthParamsFromUrl() {
  if (typeof window === "undefined") return;
  const { search, hash, pathname } = window.location;
  if (search.includes("code=") || hash.includes("access_token")) {
    window.history.replaceState({}, document.title, pathname);
  }
}

export interface AuthState {
  isConfigured: boolean;
  isReady: boolean;
  session: Session | null;
  isAuthenticated: boolean;
  signInWith: (provider: OAuthProvider) => Promise<boolean>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  // Unconfigured projects need no bootstrap — ready immediately, no listeners.
  const [isReady, setIsReady] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      const client = await getSupabaseClient();
      if (cancelled || !client) return;

      const code =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("code")
          : null;
      let hasSession = false;
      if (code) {
        const { data } = await client.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (data.session) {
          hasSession = true;
          setSession(data.session);
          const meta = data.session.user.user_metadata ?? {};
          void client.auth.updateUser({
            data: {
              origin_app: meta.origin_app ?? "regexcraft",
              last_tool: "regexcraft",
            },
          });
        }
        stripOAuthParamsFromUrl();
      }

      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (data.session) setSession(data.session);
      else if (!hasSession) setSession(null);
      setIsReady(true);

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, nextSession) => {
        // Keep synchronous — awaiting other Supabase calls here deadlocks the
        // auth client's internal lock.
        setSession(nextSession);
        if (event === "SIGNED_IN") stripOAuthParamsFromUrl();
      });

      if (cancelled) subscription.unsubscribe();
      else unsubscribe = () => subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signInWith = useCallback(async (provider: OAuthProvider) => {
    const client = await getSupabaseClient();
    if (!client) return false;
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + "/tools/anchorflow",
      },
    });
    return !error;
  }, []);

  const signOut = useCallback(async () => {
    const client = await getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
    setSession(null);
  }, []);

  return {
    isConfigured: isSupabaseConfigured,
    isReady,
    session,
    isAuthenticated: Boolean(session),
    signInWith,
    signOut,
  };
}
