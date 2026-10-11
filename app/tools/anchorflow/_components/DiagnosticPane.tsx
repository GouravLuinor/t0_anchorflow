"use client";

import React from "react";
import {
  Check,
  Copy,
  FileDiff,
  Microscope,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Keycap } from "@/components/ui/keycap";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { copyTextToClipboard } from "@/lib/utils";
import { summarizeClasses } from "../_lib/classify";
import { lineOfOffset } from "../_lib/textMetrics";
import { useToolStore } from "../_store/useToolStore";
import type { ClassifiedUses, UnifiedDiff } from "../_lib/types";

/** One authored motion: the lime hairline sweeps once as a compute settles. */
const SWEEP_MS = 600;

/**
 * The output half of the workstation — the OFFLINE HARDENER CORE rendered:
 *
 *   1. the count metrics (characters / words / bytes / lines);
 *   2. the classification summary — pinned · pending · moving · local/docker ·
 *      invalid;
 *   3. one row per collected `uses:` with its class badge (lime = already
 *      pinned, amber = moving ref, violet = remote ref pending, rose = invalid)
 *      and its `# line N · jobs.<id>.steps[i].uses` source annotation;
 *   4. the REWRITTEN YAML — the copyable, offset-surgical output (⌘⇧C);
 *   5. the red/green unified diff, empty until refs are resolved.
 *
 * With no resolutions the rewrite is a byte-identical NO-OP, so the diff reads
 * "No changes yet — resolve refs to pin" and the rewritten YAML is exactly the
 * input. That is the AC-2 round-trip, visible on first paint.
 *
 * All five interaction states are present: idle (no analysis yet), processing
 * (skeleton), error (rose), degraded (amber) and success (the real result).
 */
export function DiagnosticPane() {
  const uses = useToolStore((s) => s.report.uses);
  const rewrittenYaml = useToolStore((s) => s.report.rewrittenYaml);
  const diff = useToolStore((s) => s.report.diff);
  const metrics = useToolStore((s) => s.metrics);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const isWorkerAvailable = useToolStore((s) => s.isWorkerAvailable);
  const source = useToolStore((s) => s.source);

  const [copied, setCopied] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);
  const lastOutputRef = React.useRef<string | null>(rewrittenYaml);
  React.useEffect(() => {
    if (lastOutputRef.current === rewrittenYaml) return;
    lastOutputRef.current = rewrittenYaml;
    setSweeping(true);
    const timer = window.setTimeout(() => setSweeping(false), SWEEP_MS);
    return () => window.clearTimeout(timer);
  }, [rewrittenYaml]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (!rewrittenYaml) return;
    const succeeded = await copyTextToClipboard(rewrittenYaml);
    if (succeeded) {
      setCopied(true);
      toast({ title: "Diagnostic output copied", description: "⌘⇧C" });
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const hasOutput = Boolean(rewrittenYaml) && !errorMessage;

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
            className="h-7 gap-1.5 px-2.5 text-xs text-zinc-300 transition-colors duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
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
              The offline report appears the moment you paste or edit — parse,
              classify and diff run in this tab, never online.
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

            <div className="flex-1 overflow-y-auto">
              <UsesClassification uses={uses} source={source} />
              <RewrittenOutput rewrittenYaml={rewrittenYaml ?? ""} sweeping={sweeping} />
              <DiffView diff={diff} />
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

// ── Classification summary + per-node list ──────────────────────────────────

/**
 * The badge for one classified node: lime = immutable SHA, amber = a moving ref
 * (a warn, so it outranks the class colour), violet = a remote ref still
 * pending resolution, rose = unparseable, zinc = local / docker (skipped).
 */
function badgeFor(use: ClassifiedUses): {
  label: string;
  className: string;
} {
  if (use.cls === "sha40") {
    return { label: "pinned", className: PINNED_BADGE };
  }
  if (use.cls === "sha256") {
    return { label: "sha256", className: PINNED_BADGE };
  }
  if (use.cls === "remoteRef") {
    return use.moving
      ? { label: "moving", className: MOVING_BADGE }
      : { label: "pending", className: PENDING_BADGE };
  }
  if (use.cls === "invalid") {
    return { label: "invalid", className: INVALID_BADGE };
  }
  return { label: use.cls, className: SKIPPED_BADGE };
}

const PINNED_BADGE = "border-brand-lime/40 bg-brand-lime/10 text-brand-lime";
const MOVING_BADGE = "border-brand-amber/40 bg-brand-amber/10 text-brand-amber";
const PENDING_BADGE =
  "border-brand-violet/40 bg-brand-violet/10 text-brand-violet";
const INVALID_BADGE = "border-brand-rose/40 bg-brand-rose/10 text-brand-rose";
const SKIPPED_BADGE = "border-surface-border bg-surface-subtle text-zinc-400";

function structuralPath(uses: ClassifiedUses): string {
  return uses.scope === "job"
    ? `jobs.${uses.jobId}.uses`
    : `jobs.${uses.jobId}.steps[${uses.stepIndex ?? 0}].uses`;
}

function UsesClassification({
  uses,
  source,
}: {
  uses: ClassifiedUses[];
  source: string;
}) {
  const counts = React.useMemo(() => summarizeClasses(uses), [uses]);

  return (
    <section aria-label="Uses classification" className="border-b border-surface-border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 font-mono text-[11px] tabular-nums">
        <SummaryCell label="pinned" value={counts.pinned} tone="lime" />
        <SummaryCell label="pending" value={counts.pending} tone="violet" />
        <SummaryCell label="moving" value={counts.moving} tone="amber" />
        <SummaryCell label="local / docker" value={counts.skipped} />
        <SummaryCell label="invalid" value={counts.invalid} tone="rose" />
        <span className="ml-auto text-zinc-500">{uses.length} uses</span>
      </div>

      {uses.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-zinc-400">
          No <span className="font-mono">uses:</span> found in this workflow.
        </p>
      ) : (
        <ul
          data-testid="uses-classification-list"
          className="divide-y divide-surface-border/60 border-t border-surface-border/60"
        >
          {uses.map((use) => {
            const tone = badgeFor(use);
            return (
              <li
                key={use.id}
                data-testid="uses-row"
                data-class={use.cls}
                data-moving={use.moving ? "true" : "false"}
                className="flex flex-col gap-y-1 px-4 py-2 lg:flex-row lg:items-baseline lg:gap-x-2"
              >
                <span
                  className={`self-start rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide lg:w-16 ${tone.className}`}
                >
                  {tone.label}
                </span>
                <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-zinc-200">
                  {use.raw || "(empty)"}
                </span>
                <span className="font-mono text-[10px] leading-relaxed text-zinc-500 lg:shrink-0 lg:text-right">
                  # line {lineOfOffset(source, use.start)} ·{" "}
                  {structuralPath(use)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "lime" | "violet" | "amber" | "rose";
}) {
  const toneClass =
    tone === "lime"
      ? "text-brand-lime"
      : tone === "violet"
        ? "text-brand-violet"
        : tone === "amber"
          ? "text-brand-amber"
          : tone === "rose"
            ? "text-brand-rose"
            : "text-zinc-300";
  return (
    <span className="flex items-baseline gap-1.5">
      <strong className={`text-sm font-semibold ${toneClass}`}>{value}</strong>
      <span className="text-zinc-400">{label}</span>
    </span>
  );
}

// ── Rewritten YAML ──────────────────────────────────────────────────────────

function RewrittenOutput({
  rewrittenYaml,
  sweeping,
}: {
  rewrittenYaml: string;
  sweeping: boolean;
}) {
  return (
    <section
      aria-label="Rewritten workflow YAML"
      className="relative border-b border-surface-border"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Rewritten YAML
        </h3>
        <span className="font-mono text-[10px] text-zinc-500">
          byte-identical until refs resolve
        </span>
      </div>
      <div className="relative">
        <pre
          data-testid="diagnostic-echo"
          aria-label="Rewritten workflow YAML"
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-4 pb-3 font-mono text-[11px] leading-relaxed text-zinc-200"
        >
          {rewrittenYaml}
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
    </section>
  );
}

// ── Unified diff ────────────────────────────────────────────────────────────

function DiffView({ diff }: { diff: UnifiedDiff | null }) {
  const lines = diff?.lines ?? [];
  const changed = diff?.changed ?? 0;

  return (
    <section aria-label="Unified diff" className="relative">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
        <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          <FileDiff className="h-3.5 w-3.5" aria-hidden="true" />
          Diff
        </h3>
        <span
          data-testid="diff-changed-count"
          className="font-mono text-[10px] tabular-nums text-zinc-500"
        >
          {changed} {changed === 1 ? "change" : "changes"}
        </span>
      </div>

      {lines.length === 0 ? (
        <p
          data-testid="diff-empty"
          className="px-4 pb-4 text-xs leading-relaxed text-zinc-400"
        >
          No changes yet — resolve refs to pin.
        </p>
      ) : (
        <div className="max-h-56 overflow-auto px-4 pb-4">
          <pre className="font-mono text-[11px] leading-relaxed">
            {lines.map((line, index) => (
              <div
                key={`${line.kind}-${line.beforeLine ?? "x"}-${line.afterLine ?? "x"}-${index}`}
                className={
                  line.kind === "add"
                    ? "whitespace-pre-wrap break-words text-brand-lime"
                    : line.kind === "del"
                      ? "whitespace-pre-wrap break-words text-brand-rose"
                      : "whitespace-pre-wrap break-words text-zinc-500"
                }
              >
                <span aria-hidden="true" className="select-none pr-1 opacity-60">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                </span>
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      )}
    </section>
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
