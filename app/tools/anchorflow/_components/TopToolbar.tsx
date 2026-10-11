"use client";

import { LoaderCircle, Pin, RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToolStore } from "../_store/useToolStore";
import { DEFAULT_WORKFLOW } from "../_lib/presets";

/**
 * Toolbar for the workstation card. Every control carries all five interaction
 * states.
 *
 * The auto-resolve switch is now LIVE (the read-only resolver shipped), but it
 * stays OFF by default so the default path makes zero external requests
 * (SPEC §9 AC-12). "Resolve & pin" is the explicit, quota-spending action:
 * one dispatch, single in-flight, and never armed while the offline report is
 * still settling.
 */
export function TopToolbar() {
  const setSource = useToolStore((s) => s.setSource);
  const autoResolve = useToolStore((s) => s.autoResolve);
  const setAutoResolve = useToolStore((s) => s.setAutoResolve);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const reset = useToolStore((s) => s.reset);
  const resolveStatus = useToolStore((s) => s.resolveStatus);
  const requestResolve = useToolStore((s) => s.requestResolve);
  const pendingRefs = useToolStore((s) => s.report.uses).filter(
    (use) => use.cls === "remoteRef"
  ).length;

  const resolving = resolveStatus === "running";
  // Nothing to spend quota on: the workflow is already pinned or has no refs.
  const resolveDisabled = isProcessing || resolving || pendingRefs === 0;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border bg-surface-base/80 px-4 py-2.5">
      {/* Offline-first posture, stated where the work happens */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          Offline analysis
        </span>
        <span
          className="h-1 w-1 rounded-full bg-surface-borderHover"
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] text-zinc-500">
          no resolve until asked
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-subtle/80 px-2.5 py-1">
            <Switch
              id="auto-resolve-toggle"
              checked={autoResolve}
              onCheckedChange={setAutoResolve}
              aria-label="Auto-resolve refs against api.github.com"
            />
            <label
              htmlFor="auto-resolve-toggle"
              className="cursor-pointer select-none font-mono text-[11px] text-zinc-400"
            >
              Auto-resolve
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="rounded font-mono text-[11px] text-brand-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
                >
                  off by default
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Resolve refs to commit SHAs after every edit. Off by default:
                the default path makes zero external requests (SPEC §9 AC-12).
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {isProcessing && (
          <div
            role="status"
            aria-label="Analyzing workflow"
            className="flex h-7 items-center gap-1.5 rounded-full border border-surface-border bg-surface-subtle px-2.5 font-mono text-[11px] text-zinc-300"
          >
            <span
              className="h-2 w-2 rounded-full border-2 border-brand-lime/30 border-t-brand-lime animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Analyzing…
          </div>
        )}

        <div className="hidden h-4 w-[1px] bg-surface-border sm:block" />

        <Button
          variant="outline"
          size="sm"
          onClick={requestResolve}
          disabled={resolveDisabled}
          aria-label="Resolve every ref to a commit SHA"
          data-testid="resolve-pin-button"
          data-status={resolveStatus}
          className={cn(
            "h-8 gap-1.5 border-surface-border bg-surface-default text-xs text-zinc-300",
            "hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.98]",
            resolveDisabled &&
              "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {resolving ? (
            <LoaderCircle
              className="h-3.5 w-3.5 animate-spin text-brand-lime motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Pin className="h-3.5 w-3.5 text-brand-lime" aria-hidden="true" />
          )}
          {resolving ? "Resolving…" : "Resolve & pin"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSource(DEFAULT_WORKFLOW)}
          disabled={isProcessing}
          className={cn(
            "h-8 gap-1.5 border-surface-border bg-surface-default text-xs text-zinc-300",
            "hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.98]"
          )}
        >
          <Wand2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          Example
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={isProcessing}
          className="h-8 gap-1.5 border-surface-border bg-surface-default text-xs text-zinc-300 hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.98]"
        >
          <RotateCcw className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </header>
  );
}
