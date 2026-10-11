"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { useAuth, userEmail } from "../../_hooks/useAuth";
import { useAuthPromptStore } from "../../_store/useAuthPromptStore";

export function SignInButton() {
  const { isConfigured, isAuthenticated, session } = useAuth();
  const open = useAuthPromptStore((s) => s.open);
  const [showNotice, setShowNotice] = useState(false);

  // Auto-dismiss the degraded notice; the timer is cleaned on unmount.
  useEffect(() => {
    if (!showNotice) return;
    const timer = window.setTimeout(() => setShowNotice(false), 4500);
    return () => window.clearTimeout(timer);
  }, [showNotice]);

  const email = userEmail(session);
  const initial = email?.[0]?.toUpperCase();

  const handleClick = () => {
    // No Supabase env: never break, never dead-end — explain and close.
    if (!isConfigured) {
      setShowNotice(true);
      return;
    }
    open("manual");
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={
          isAuthenticated ? `Account: ${email ?? "signed in"}` : "Sign in"
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-surface-border bg-surface-subtle px-2.5 text-xs font-medium text-zinc-300 transition-all duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isAuthenticated ? (
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <GitHubMark />
        )}
        <span className="hidden sm:inline" aria-hidden={isAuthenticated}>
          {isAuthenticated && initial ? initial : "Sign in"}
        </span>
      </button>

      {showNotice && !isConfigured && (
        <div
          role="status"
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto w-full max-w-sm rounded-xl border border-surface-border bg-surface-default p-4 text-sm text-zinc-200 glass-edge"
        >
          <p className="font-semibold text-zinc-100">
            Sign-in isn&rsquo;t enabled yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Anchorflow runs entirely in your browser, so pinning, auditing and
            copying never need an account. Connecting a Supabase project only
            adds cross-device history sync.
          </p>
        </div>
      )}
    </>
  );
}

export function GoogleMark() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function GitHubMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-1.94c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.2.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}
