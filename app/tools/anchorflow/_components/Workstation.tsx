"use client";

import { Toaster } from "@/components/ui/toast";
import { useKeyboardShortcuts } from "../_hooks/useKeyboardShortcuts";
import { useToolWorker } from "../_hooks/useToolWorker";
import { useToolStore } from "../_store/useToolStore";
import { CertifiedCopy } from "./CertifiedCopy";
import { CommandPalette } from "./CommandPalette";
import { StatusLiveRegion } from "./StatusLiveRegion";
import { WorkflowEditor } from "./WorkflowEditor";
import { SignInModal } from "./auth/SignInModal";

/**
 * The working surface: "Your workflow" beside its certified copy. On wide
 * screens the editor stays put while the copy scrolls; below lg they stack.
 */
export function Workstation() {
  useToolWorker();
  useKeyboardShortcuts();

  const isWorkerAvailable = useToolStore((s) => s.isWorkerAvailable);
  // Exposed for the e2e journeys that must tell the worker pipeline from the
  // main-thread fallback: `pending` before spawn, `worker`, or `main`.
  const engine = isWorkerAvailable === null ? "pending" : isWorkerAvailable ? "worker" : "main";

  return (
    <>
      <div
        id="workstation"
        data-engine={engine}
        className="grid scroll-mt-20 grid-cols-1 rounded border border-line-strong bg-sheet lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]"
      >
        <section
          aria-label="Your workflow"
          className="h-[340px] border-b border-line lg:sticky lg:top-[72px] lg:h-[calc(100vh-96px)] lg:max-h-[760px] lg:border-b-0 lg:border-r"
        >
          <WorkflowEditor />
        </section>
        <section aria-label="Certified copy" className="min-w-0">
          <CertifiedCopy />
        </section>
      </div>

      <StatusLiveRegion />
      <CommandPalette />
      <SignInModal />
      <Toaster />
    </>
  );
}
