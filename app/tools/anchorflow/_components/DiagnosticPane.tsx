"use client";

import React from "react";
import { Check, Copy, Microscope, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Keycap } from "@/components/ui/keycap";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { copyTextToClipboard } from "@/lib/utils";
import { useToolStore } from "../_store/useToolStore";

/** One authored motion: the lime hairline sweeps once as a compute settles. */
const SWEEP_MS = 600;

/**
 * The output half of the workstation — a mirror of the worker payload. Today
 * the worker returns the placeholder measurement (raw text plus
 * character / word / byte / line counts) and that is exactly what renders here;
 * when the domain lands, the pinned YAML, the red/green diff, the findings
 * report and the per-pin receipts replace the echo in this same slot.
 *
 * All five interaction states are present: idle (no analysis yet), processing
 * (skeleton), error (rose), degraded (amber), success (echo + counts).
 */
export function DiagnosticPane() {
  const echo = useToolStore((s) => s.report.echo);
  const metrics = useToolStore((s) => s.metrics);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const isWorkerAvailable = useToolStore((s) => s.isWorkerAvailable);

  const [copied, setCopied] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);
  const lastEchoRef = React.useRef<string | null>(echo);
  React.useEffect(() => {
    if (lastEchoRef.current === echo) return;
    lastEchoRef.current = echo;
    setSweeping(true);
    const timer = window.setTimeout(() => setSweeping(false), SWEEP_MS);
    return () => window.clearTimeout(timer);
  }, [echo]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (!echo) return;
    const succeeded = await copyTextToClipboard(echo);
    if (succeeded) {
      setCopied(true);
      toast({ title: "Diagnostic output copied", description: "⌘⇧C" });
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const hasOutput = Boolean(echo) && !errorMessage;

  return (
    <div className="flex h-full min-h-[400px] flex-col overflow-hidden bg-surface-base/30 lg:min-h-0">
      <div className="flex items-center justify-between gap-2 border-b border-surface-border bg-surface-subtle/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Microscope className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Diagnostic result
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">
            <Keycap size="xs">⌘⇧C</Keycap>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={!hasOutput}
            className="h-7 gap-1.5 px-2.5 text-xs text-zinc-300 hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.98]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-brand-lime" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {errorMessage ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <TriangleAlert
              className="h-8 w-8 text-brand-rose/50"
              aria-hidden="true"
            />
            <p className="max-w-sm text-xs leading-relaxed text-brand-rose">
              {errorMessage}
            </p>
          </div>
        ) : isProcessing && !hasOutput ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : !hasOutput ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Microscope className="h-8 w-8 text-zinc-400" aria-hidden="true" />
            <p className="max-w-xs text-xs leading-relaxed text-zinc-400">
              The worker result mirrors here the moment you paste or edit.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            {/* Measurement grid — mono is machine data here, never decoration */}
            <dl className="grid grid-cols-2 gap-px border-b border-surface-border bg-surface-border/60 sm:grid-cols-4">
              <Metric label="characters" value={metrics.characterCount} />
              <Metric label="words" value={metrics.wordCount} />
              <Metric label="bytes" value={metrics.byteCount} tone="lime" />
              <Metric label="lines" value={metrics.lineCount} />
            </dl>

            <div className="relative flex-1 overflow-hidden">
              <pre
                data-testid="diagnostic-echo"
                aria-label="Analyzed output mirror"
                className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-zinc-200"
              >
                {echo}
              </pre>
              <span
                aria-hidden="true"
                className={
                  sweeping
                    ? "scan-sweep pointer-events-none absolute inset-x-0 bottom-0 block h-0.5"
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Pane footer telemetry */}
      <div className="flex items-center justify-between gap-3 border-t border-surface-border bg-surface-subtle/30 px-4 py-2 font-mono text-[11px] text-zinc-400">
        <span>
          engine{" "}
          <strong className="tabular-nums text-brand-lime">
            {Math.round(metrics.parseTimeMs * 100) / 100}ms
          </strong>
        </span>
        {isWorkerAvailable === false ? (
          <span className="text-brand-amber">main-thread fallback</span>
        ) : (
          <span className="text-zinc-500">worker · id-correlated</span>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "lime";
}) {
  return (
    <div className="bg-surface-subtle/30 px-3 py-2.5">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
        {label}
      </dt>
      <dd
        className={
          tone === "lime"
            ? "mt-0.5 font-mono text-lg font-semibold tabular-nums text-brand-lime"
            : "mt-0.5 font-mono text-lg font-semibold tabular-nums text-zinc-100"
        }
      >
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}
