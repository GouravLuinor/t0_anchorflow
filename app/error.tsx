"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * Route-level error boundary. The workstation is fully client-side, so the
 * recovery path is a reload of the same route — never a dead end.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Anchorflow route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <TriangleAlert className="h-8 w-8 text-brand-rose" aria-hidden="true" />
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        The workstation hit an unexpected error
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-zinc-400">
        Nothing left your browser. Reload to restart the analysis pipeline — the
        seeded workflow and your last input are still on disk.
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-9 items-center justify-center rounded-lg border border-surface-border bg-surface-default px-4 text-sm font-medium text-zinc-200 transition-[background-color,border-color,color,transform] duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        Reload the workstation
      </button>
    </div>
  );
}
