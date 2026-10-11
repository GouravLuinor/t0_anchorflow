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
import {
  SEVERITY_BANDS,
  countBySeverity,
  formatFinding,
  formatFindings,
  sortFindings,
} from "../_lib/findings";
import { RATE_LIMIT_RESERVE } from "../_lib/constants";
import { effectiveJobGrants } from "../_lib/grantTable";
import { lineOfOffset } from "../_lib/textMetrics";
import { useToolStore } from "../_store/useToolStore";
import type {
  ClassifiedUses,
  Finding,
  GrantTable,
  RateLimitState,
  Resolution,
  Severity,
  UnifiedDiff,
} from "../_lib/types";

/** One authored motion: the lime hairline sweeps once as a compute settles. */
const SWEEP_MS = 600;

/**
 * The output half of the workstation — the OFFLINE HARDENER CORE rendered:
 *
 *   1. the count metrics (characters / words / bytes / lines);
 *   2. the classification summary — pinned · pending · moving · local/docker ·
 *      invalid;
 *   3. the FINDINGS REPORT — the four offline audits (permissions, template
 *      injection, dangerous triggers, persist-credentials) grouped by severity
 *      band, critical → minor, with a severity summary chip row, a per-finding
 *      copy and a "Copy all findings";
 *   4. the TOKEN GRANT TABLE — the effective `GITHUB_TOKEN` scope per job;
 *   5. one row per collected `uses:` with its class badge (lime = already
 *      pinned, amber = moving ref, violet = remote ref pending, rose = invalid)
 *      and its `# line N · jobs.<id>.steps[i].uses` source annotation;
 *   6. the RATE-LIMIT BANNER (amber) when the GitHub hourly floor is hit —
 *      never a blocker: the offline report above is still complete;
 *   7. the RESOLUTION RECEIPTS — one per remote ref, in call order:
 *      `<endpoint> → <tag-object-sha> → <commit-sha>`, its `ls-remote`
 *      cross-check line and its resolvedAt, all mono machine data;
 *   8. the REWRITTEN YAML — the copyable, offset-surgical output (⌘⇧C),
 *      repainted pinned once refs resolve;
 *   9. the red/green unified diff, empty until refs are resolved.
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
  const findings = useToolStore((s) => s.report.findings);
  const permissions = useToolStore((s) => s.report.permissions);
  const rewrittenYaml = useToolStore((s) => s.report.rewrittenYaml);
  const diff = useToolStore((s) => s.report.diff);
  const metrics = useToolStore((s) => s.metrics);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const isWorkerAvailable = useToolStore((s) => s.isWorkerAvailable);
  const rateLimit = useToolStore((s) => s.rateLimit);
  const resolutions = useToolStore((s) => s.report.resolutions);
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

  /** How many refs Phase B actually pinned — drives the output section copy. */
  const resolvedPins = React.useMemo(
    () =>
      resolutions.filter(
        (resolution) =>
          resolution.status === "resolved" && Boolean(resolution.commitSha)
      ).length,
    [resolutions]
  );

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
              <FindingsReport findings={findings} source={source} />
              <GrantTableView grants={permissions} />
              <UsesClassification uses={uses} source={source} />
              <RateLimitBanner budget={rateLimit} />
              <ResolutionReceipts
                resolutions={resolutions}
                pinnedCount={resolvedPins}
                source={source}
              />
              <RewrittenOutput
                rewrittenYaml={rewrittenYaml ?? ""}
                sweeping={sweeping}
                pinnedCount={resolvedPins}
              />
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

// ── Rate-limit banner + resolution receipts ──────────────────────────────────

/**
 * The amber "we stopped, not a blocker" banner (ARCH §8): shown when the
 * optimistic ledger has reached the reserve floor. It always carries the
 * friendly copy — the offline report above is still complete — so a rate
 * limit never looks like a broken tool.
 */
function RateLimitBanner({ budget }: { budget: RateLimitState }) {
  const [now] = React.useState(() => Date.now());
  const limited = budget.remaining <= RATE_LIMIT_RESERVE;
  if (!limited) return null;

  const reset =
    budget.resetAt > 0
      ? `resets in ${countdown(budget.resetAt, now)}`
      : "resets when the next hourly window opens";

  return (
    <section
      role="status"
      aria-label="GitHub API rate limit"
      data-testid="rate-limit-banner"
      data-remaining={budget.remaining}
      className="border-b border-surface-border bg-brand-amber/10 px-4 py-2.5"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs leading-relaxed text-brand-amber">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <strong className="font-medium">
          GitHub&apos;s hourly API limit is reached
        </strong>
        <span className="font-mono text-[10px] tabular-nums">
          {budget.remaining} of {budget.limit} left · {reset}
        </span>
      </p>
      <p className="pt-1 text-xs leading-relaxed text-zinc-300">
        Nothing was rewritten. The offline report above is still complete —
        findings, permissions and the uses classification are untouched — so
        re-run &ldquo;Resolve &amp; pin&rdquo; after the window resets.
      </p>
    </section>
  );
}

/** `3m 12s` from an absolute reset, counted against `nowMs`. */
function countdown(resetAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((resetAt - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds % 60}s`;
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

/**
 * The receipts: one block per remote ref, in the source order Phase A gave.
 * A resolved ref renders BOTH hops —
 * `GET /repos/o/r/git/ref/tags/v9.12.0 → 85b44e09… → fc7eed08…` — which is the
 * proof that the annotated tag was dereferenced to the commit it names, plus
 * the reproducible `git ls-remote` cross-check line and the resolvedAt stamp.
 * An unresolved ref names the endpoint that stopped it, never a silent drop.
 */
function ResolutionReceipts({
  resolutions,
  pinnedCount,
  source,
}: {
  resolutions: Resolution[];
  pinnedCount: number;
  source: string;
}) {
  if (resolutions.length === 0) return null;

  return (
    <section
      aria-label="Resolution receipts"
      className="border-b border-surface-border"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Resolution receipts
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {pinnedCount} of {resolutions.length} pinned
        </span>
      </div>

      <ul data-testid="receipt-list" className="space-y-1.5 px-4 pb-3">
        {resolutions.map((resolution) => {
          const receipt = resolution.receipt;
          const uses = resolution.ref;
          const status = resolution.status;
          const chain = receipt?.chain ?? [];
          return (
            <li
              key={uses.id}
              data-testid="receipt-item"
              data-status={status}
              data-ref={`${uses.owner}/${uses.repo}@${uses.ref}`}
              className="rounded border border-surface-border bg-surface-subtle/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] leading-relaxed">
                <span className="text-zinc-200">
                  {uses.owner}/{uses.repo}
                  {uses.subpath ? `/${uses.subpath}` : ""}
                  {uses.ref ? `@${uses.ref}` : ""}
                </span>
                {status === "resolved" ? (
                  <span className="inline-flex items-center gap-1 rounded border border-brand-lime/40 bg-brand-lime/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-lime">
                    pinned
                  </span>
                ) : status === "unknown-ref" ? (
                  <span className="inline-flex items-center gap-1 rounded border border-brand-rose/40 bg-brand-rose/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-rose">
                    unknown ref
                  </span>
                ) : status === "rate-limited" ? (
                  <span className="inline-flex items-center gap-1 rounded border border-brand-amber/40 bg-brand-amber/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-amber">
                    not resolved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-surface-border bg-surface-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {status}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-zinc-500">
                  #{lineOfOffset(source, uses.start)}
                </span>
              </div>

              {/* The chain: one arrow per hop, both hops when annotated. */}
              <p
                data-testid="receipt-chain"
                className="mt-1 break-all font-mono text-[10px] leading-relaxed text-zinc-400"
              >
                {chain.length === 0
                  ? "no API call was made for this ref"
                  : chain
                      .map(
                        (hop) =>
                          `${hop.endpoint}${
                            hop.sha ? ` → ${shortSha(hop.sha)}` : ""
                          }${
                            hop.httpStatus && hop.sha
                              ? ` (${hop.httpStatus})`
                              : ""
                          }`
                      )
                      .join("  →  ")}
              </p>

              {resolution.commitSha ? (
                <p className="mt-1 font-mono text-[11px] text-zinc-200">
                  {resolution.commitSha}
                </p>
              ) : null}

              <p className="pt-1 text-xs leading-relaxed text-zinc-400">
                {resolution.commitSha
                  ? "The pinned SHA is a point-in-time snapshot: the tag it replaced can still move, so re-resolve before a release to catch drift."
                  : `${receipt?.note ?? "This ref was not resolved."} It is still not pinned to a SHA, and the offline report above is still complete — findings, permissions and the uses classification are untouched.`}
              </p>

              <p className="flex flex-wrap gap-x-3 pt-1 font-mono text-[10px] text-zinc-500">
                <span data-testid="receipt-resolved-at">
                  resolvedAt {receipt?.resolvedAt ?? "—"}
                </span>
                {receipt?.lsRemote ? (
                  <span className="break-all">
                    ls-remote {receipt.lsRemote}
                  </span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `85b44e09…` — a sha short enough to read, long enough to be unambiguous. */
function shortSha(sha: string): string {
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha;
}

// ── Findings report ─────────────────────────────────────────────────────────

/**
 * The four finding bands, worst-first, with their Matchlight colours:
 * rose = critical (error) · amber = major (warn) · violet = minor (the
 * secondary grade) · zinc = info · lime = the all-clear state.
 */
const SEVERITY_STYLE: Record<
  Severity,
  { label: string; band: string; chip: string; dot: string }
> = {
  error: {
    label: "critical",
    band: "text-brand-rose",
    chip: "border-brand-rose/40 bg-brand-rose/10 text-brand-rose",
    dot: "bg-brand-rose",
  },
  warn: {
    label: "major",
    band: "text-brand-amber",
    chip: "border-brand-amber/40 bg-brand-amber/10 text-brand-amber",
    dot: "bg-brand-amber",
  },
  minor: {
    label: "minor",
    band: "text-brand-violet",
    chip: "border-brand-violet/40 bg-brand-violet/10 text-brand-violet",
    dot: "bg-brand-violet",
  },
  info: {
    label: "info",
    band: "text-zinc-400",
    chip: "border-surface-border bg-surface-subtle text-zinc-400",
    dot: "bg-zinc-400",
  },
};

const FINDING_COPY_RESET_MS = 1500;

/**
 * The offline audit report: a severity summary chip row, then every finding
 * grouped by band (critical → info) with its why, its expression and its fix.
 * The copy is the canonical order (AC-10), so the clipboard always reads the
 * same way for the same workflow.
 */
function FindingsReport({ findings, source }: { findings: Finding[]; source: string }) {
  // Canonical order (AC-10). The bands below group by severity, so the array
  // only needs to be deterministic — never re-sorted per render.
  const ordered = React.useMemo(() => sortFindings(findings), [findings]);
  const counts = React.useMemo(() => countBySeverity(ordered), [ordered]);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!copiedAll && !copiedId) return;
    const timer = window.setTimeout(() => {
      setCopiedAll(false);
      setCopiedId(null);
    }, FINDING_COPY_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copiedAll, copiedId]);

  const handleCopyAll = async () => {
    if (ordered.length === 0) return;
    const succeeded = await copyTextToClipboard(formatFindings(ordered));
    if (succeeded) {
      setCopiedAll(true);
      toast({
        title: "All findings copied",
        description: `${ordered.length} finding${ordered.length === 1 ? "" : "s"}`,
      });
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleCopyOne = async (finding: Finding) => {
    const succeeded = await copyTextToClipboard(formatFinding(finding));
    if (succeeded) {
      setCopiedId(finding.id);
      toast({ title: "Finding copied" });
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <section aria-label="Security findings" className="border-b border-surface-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3 pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Findings
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {ordered.length} total
        </span>
        <div
          data-testid="findings-counts"
          className="flex flex-wrap items-center gap-1.5"
        >
          {ordered.length === 0 ? (
            <span
              data-testid="findings-clear"
              className="inline-flex items-center gap-1 rounded border border-brand-lime/40 bg-brand-lime/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-lime"
            >
              no findings
            </span>
          ) : (
            SEVERITY_BANDS.filter((band) => counts[band.severity] > 0).map(
              (band) => (
                <span
                  key={band.severity}
                  data-testid={`findings-count-${band.label}`}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${SEVERITY_STYLE[band.severity].chip}`}
                >
                  {SEVERITY_STYLE[band.severity].label}
                  <strong className="tabular-nums">{counts[band.severity]}</strong>
                </span>
              )
            )
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">
            <Keycap size="xs">⌘⇧C</Keycap>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyAll}
            disabled={ordered.length === 0}
            data-testid="copy-all-findings"
            className="h-7 gap-1.5 px-2.5 text-xs text-zinc-300 transition-colors duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copiedAll ? (
              <>
                <Check className="h-3.5 w-3.5 text-brand-lime" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                Copy all findings
              </>
            )}
          </Button>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="px-4 pb-3 text-xs leading-relaxed text-zinc-400">
          The four offline audits — permissions, template injection, dangerous
          triggers and persist-credentials — found nothing to report in this
          workflow.
        </p>
      ) : (
        <div data-testid="findings-report">
          {SEVERITY_BANDS.map((band) => {
            const group = ordered.filter((f) => f.severity === band.severity);
            if (group.length === 0) return null;
            const style = SEVERITY_STYLE[band.severity];
            return (
              <div
                key={band.severity}
                data-testid={`findings-band-${band.label}`}
                data-severity={band.severity}
                className="border-t border-surface-border/60 px-4 py-2.5"
              >
                <div className="flex items-baseline gap-2 pb-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                  <h4
                    className={`font-mono text-[10px] uppercase tracking-wider ${style.band}`}
                  >
                    {style.label}
                  </h4>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                    {group.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.map((finding) => (
                    <li
                      key={finding.id}
                      data-testid="finding-item"
                      data-severity={finding.severity}
                      data-category={finding.category}
                      data-finding-id={finding.id}
                      className="rounded border border-surface-border bg-surface-subtle/40 px-3 py-2"
                    >
                      <div className="flex items-baseline gap-x-2 gap-y-1">
                        <span className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-zinc-100">
                          {finding.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                          {finding.start === null
                            ? finding.where
                            : `# line ${lineOfOffset(source, finding.start)} · ${finding.where}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyOne(finding)}
                          aria-label={`Copy finding ${finding.id}`}
                          data-testid="copy-finding"
                          className="shrink-0 rounded border border-surface-border bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                        >
                          {copiedId === finding.id ? (
                            <Check className="h-3 w-3 text-brand-lime" aria-hidden="true" />
                          ) : (
                            <Copy className="h-3 w-3" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <p className="pt-1 text-xs leading-relaxed text-zinc-300">
                        {finding.detail}
                      </p>
                      {finding.evidence ? (
                        <p className="mt-1 break-all rounded bg-surface-base px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-400">
                          {finding.evidence}
                        </p>
                      ) : null}
                      <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-zinc-400">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                          fix
                        </span>
                        <span className="min-w-0">{finding.remediation}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Token grant table ────────────────────────────────────────────────────────

/** `contents: write` · `id-token: read` — the grant, in the worktable's mono. */
function grantLabel(
  scope: string,
  level: "read" | "write" | "none"
): { text: string; className: string } {
  if (level === "write") {
    return { text: `${scope}: write`, className: "border-brand-rose/40 bg-brand-rose/10 text-brand-rose" };
  }
  if (level === "read") {
    return { text: `${scope}: read`, className: "border-surface-border bg-surface-subtle text-zinc-300" };
  }
  return { text: `${scope}: none`, className: "border-surface-border bg-surface-subtle text-zinc-500" };
}

/**
 * The effective `GITHUB_TOKEN` grant per job: a job's own block overrides the
 * top-level block per scope (ARCH §3.5), so each row shows WHERE the level came
 * from — the job's own block (violet = secondary scope) or the inherited top
 * block. A workflow with no block at all is marked UNSET, because that is a
 * finding in itself (the token falls back to the repository default).
 */
function GrantTableView({ grants }: { grants: GrantTable | null }) {
  if (!grants) {
    return (
      <section aria-label="Token grant table" className="border-b border-surface-border">
        <p className="px-4 py-3 text-xs text-zinc-400">
          The grant table appears once a workflow parses.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Token grant table"
      className="border-b border-surface-border px-4 pb-3 pt-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Token grant table
        </h3>
        {grants.unset ? (
          <span className="inline-flex items-center rounded border border-brand-amber/40 bg-brand-amber/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-amber">
            unset — inherits the repository default
          </span>
        ) : null}
      </div>

      {grants.top ? (
        <p className="pb-1 font-mono text-[10px] text-zinc-500">
          top-level:{" "}
          <span className="text-zinc-300">
            {grants.top.all
              ? `${grants.top.all}-all (${Object.keys(grants.top.scopes).length} scope overrides)`
              : Object.keys(grants.top.scopes).length === 0
                ? "{}"
                : Object.entries(grants.top.scopes)
                    .map(([scope, level]) => `${scope}: ${level}`)
                    .join(" · ")}
          </span>
        </p>
      ) : null}

      <div data-testid="grant-table" className="space-y-1.5">
        {grants.jobs.map((job) => {
          const rows = effectiveJobGrants(
            { id: job.jobId, permissions: job.block },
            grants.top
          );
          return (
            <div key={job.jobId} data-testid="grant-row" data-job={job.jobId}>
              <p className="font-mono text-[10px] text-zinc-500">
                jobs.{job.jobId}
                {job.block ? "" : " — no block, inherits the top-level grant"}
              </p>
              {rows.length === 0 ? (
                <p className="pl-2 font-mono text-[10px] text-zinc-500">
                  no scopes granted
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1 pl-2 pt-0.5">
                  {rows.map((row) => {
                    const label = grantLabel(row.scope, row.level);
                    return (
                      <li
                        key={`${row.scope}-${row.source}`}
                        data-testid="grant-scope"
                        data-scope={row.scope}
                        data-level={row.level}
                        title={row.source === "top" ? "inherited from the top-level block" : `set by jobs.${job.jobId}`}
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] ${label.className}`}
                      >
                        {label.text}
                        <span className="pl-1 text-zinc-500">
                          {row.source === "top" ? "top" : "job"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
  pinnedCount,
}: {
  rewrittenYaml: string;
  sweeping: boolean;
  pinnedCount: number;
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
          {pinnedCount > 0
            ? `${pinnedCount} ref${pinnedCount === 1 ? "" : "s"} pinned to SHAs`
            : "byte-identical until refs resolve"}
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
