"use client";

import { useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthPromptStore } from "../../_store/useAuthPromptStore";
import { useAuth, userEmail, type OAuthProvider } from "../../_hooks/useAuth";
import { GitHubMark, GoogleMark } from "./SignInButton";

const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: "google", label: "Continue with Google" },
  { id: "github", label: "Continue with GitHub" },
];

export function SignInModal() {
  const { isOpen, trigger, close } = useAuthPromptStore();
  const { isConfigured, isAuthenticated, session, signInWith, signOut } =
    useAuth();
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const email = userEmail(session);

  const copy = useMemo(() => {
    if (isAuthenticated)
      return {
        title: "You&rsquo;re signed in",
        description: `Signed in as ${email ?? "your account"}. Audit history and saved workflows are unlocked.`,
      };
    if (trigger === "export")
      return {
        title: "Sign in to sync across devices",
        description:
          "Saving audit snapshots uses a free Nor AI account. Core workflow work — pin, audit, diff, copy — stays free forever.",
      };
    if (trigger === "return-visit")
      return {
        title: "Welcome back to Anchorflow",
        description:
          "Sign in to sync saved workflows and audit history across your devices.",
      };
    return {
      title: "Sign in to Anchorflow",
      description:
        "Connect Google or GitHub to sync saved workflows and audit history across devices.",
    };
  }, [isAuthenticated, email, trigger]);

  const handleProvider = async (provider: OAuthProvider) => {
    setPending(provider);
    try {
      await signInWith(provider);
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-md shadow-elevated">
        <DialogHeader>
          <div
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-elevated text-brand-lime"
            aria-hidden="true"
          >
            <Lock className="h-5 w-5" />
          </div>
          <DialogTitle className="text-center">{copy.title}</DialogTitle>
          <DialogDescription className="mt-2 text-center text-sm leading-relaxed">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        {isAuthenticated ? (
          <div className="mt-2 flex flex-col gap-3">
            <button
              type="button"
              onClick={async () => {
                await signOut();
                close();
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-border bg-surface-subtle text-sm font-medium text-zinc-200 transition-all duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-brand-rose active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2.5">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!isConfigured || pending !== null}
                onClick={() => handleProvider(provider.id)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-border bg-surface-subtle text-sm font-medium text-zinc-200 transition-all duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending === provider.id ? (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : provider.id === "github" ? (
                  <GitHubMark />
                ) : (
                  <GoogleMark />
                )}
                {provider.label}
              </button>
            ))}

            {!isConfigured && (
              <p className="mt-1 rounded-lg border border-brand-amber/30 bg-brand-amber/10 px-3 py-2 text-xs leading-relaxed text-brand-amber">
                Everything in Anchorflow works without an account — sign-in only
                powers cross-device sync.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
