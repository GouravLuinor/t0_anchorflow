"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
        title: "You\u2019re signed in",
        description: `Signed in as ${email ?? "your account"}. Anchorflow works the same signed in or out; it stores nothing for you yet.`,
      };
    if (trigger === "export")
      return {
        title: "Sign in to Nor AI",
        description:
          "Pinning, auditing and copying stay free without an account. Signing in only links this browser to your Nor AI account.",
      };
    return {
      title: "Sign in to Nor AI",
      description:
        "Everything in Anchorflow works without an account, and nothing is saved to one yet. Signing in links this browser to the account other Nor AI tools use.",
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed">
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded border border-line-strong bg-sheet text-sm font-semibold text-ink transition-colors duration-150 ease-out-expo hover:bg-sunk hover:text-critical disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center gap-2 rounded border border-line-strong bg-sheet text-sm font-semibold text-ink transition-colors duration-150 ease-out-expo hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50"
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
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Sign-in isn&rsquo;t enabled on this deployment. You never need
                an account to use Anchorflow.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
