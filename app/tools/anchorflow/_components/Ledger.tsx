"use client";

import React from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn, copyTextToClipboard } from "@/lib/utils";
import type { LedgerRow, LedgerState } from "../_lib/ledger";
import { lineOfOffset } from "../_lib/textMetrics";
import { OpenSeal, Seal } from "./Seal";

/** How many rows show before "Show all" on a long workflow. */
const COLLAPSED_ROWS = 8;

const STATE_TONE: Record<LedgerState, string> = {
  pinned: "text-seal",
  "pinned-now": "text-seal",
  moving: "text-moving",
  tag: "text-moving",
  unresolved: "text-major",
  refused: "text-critical",
  local: "text-ink-3",
  docker: "text-ink-3",
  invalid: "text-critical",
};

function structuralPath(row: LedgerRow): string {
  const u = row.use;
  return u.scope === "job" ? `jobs.${u.jobId}.uses` : `jobs.${u.jobId}.steps[${u.stepIndex ?? 0}].uses`;
}

/** `owner/repo/sub@` — the part of the uses: value a pin keeps. */
function actionName(row: LedgerRow): string {
  const u = row.use;
  if (u.cls === "local" || u.cls === "docker" || u.cls === "invalid" || !u.owner) return u.raw || "(empty)";
  return `${u.owner}/${u.repo}${u.subpath ? `/${u.subpath}` : ""}`;
}

/**
 * The uses ledger: one row per `uses:` in source order. A pinned row wears the
 * seal drawn from its commit and shows the full SHA; an unpinned one shows an
 * open seal and the ref it rides. Once Phase B has run, every remote row
 * carries its receipt (the API hops, the ls-remote cross-check, the time).
 */
export function Ledger({
  rows,
  source,
  hasResolutions,
}: {
  rows: LedgerRow[];
  source: string;
  hasResolutions: boolean;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);

  if (rows.length === 0) {
    return (
      <p className="border-t border-line py-4 text-sm text-ink-2">
        No <span className="font-mono text-[13px]">uses:</span> steps in this workflow, so there is nothing to pin.
      </p>
    );
  }

  return (
    <section aria-label="Uses classification" className="border-t border-ink/80">
      <ul
        data-testid={hasResolutions ? "receipt-list" : "uses-classification-list"}
        className="divide-y divide-line"
      >
        {visible.map((row) => (
          <LedgerItem key={row.use.id} row={row} source={source} />
        ))}
      </ul>
      {rows.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-1 inline-flex items-center gap-1 rounded py-2 text-sm font-semibold text-seal hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length} actions`}
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", showAll && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

function LedgerItem({ row, source }: { row: LedgerRow; source: string }) {
  const sealed = row.sha !== null && (row.state === "pinned" || row.state === "pinned-now");
  const line = lineOfOffset(source, row.use.start);
  const ref = row.use.cls === "remoteRef" ? row.use.ref : null;
  const comment = row.use.existingComment?.replace(/^#\s*/, "");

  return (
    <li
      data-testid="uses-row"
      data-class={row.use.cls}
      data-moving={row.use.moving ? "true" : "false"}
      data-state={row.state}
      className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 py-2.5 sm:grid-cols-[28px_minmax(0,1fr)_auto]"
    >
      <div className="pt-0.5">
        {sealed ? (
          <Seal seed={row.sha!} drawIn={row.state === "pinned-now"} title={`Seal for ${row.sha}`} />
        ) : (
          <OpenSeal tone={row.state === "moving" || row.state === "tag" ? "moving" : "muted"} />
        )}
      </div>

      <div className="min-w-0">
        <p className="break-all font-mono text-[12px] leading-relaxed text-ink">
          {actionName(row)}
          {row.use.cls === "remoteRef" || row.use.cls === "sha40" || row.use.cls === "sha256" ? (
            <span className={sealed ? "text-ink-2" : "text-moving"}>
              @{row.state === "pinned-now" ? row.sha : row.use.ref}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span className={cn("font-semibold", STATE_TONE[row.state])}>{row.label}</span>
          {row.state === "pinned-now" && ref ? <span className="text-ink-2">was @{ref}</span> : null}
          {row.state === "pinned" && comment ? <span className="text-ink-2"># {comment}</span> : null}
          <span className="font-mono text-[11px] text-ink-3 sm:hidden">line {line}</span>
          <span className="sr-only"> at {structuralPath(row)}</span>
        </p>
        {row.resolution ? <Receipt row={row} /> : null}
      </div>

      <p className="figures hidden whitespace-nowrap pt-0.5 text-right font-mono text-[11px] leading-relaxed text-ink-3 sm:block">
        <span title={structuralPath(row)}>line {line}</span>
      </p>
    </li>
  );
}

function Receipt({ row }: { row: LedgerRow }) {
  const resolution = row.resolution!;
  const receipt = resolution.receipt;
  const chain = receipt?.chain ?? [];
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  // The receipt carries the peeled ref; the check is the full command for it.
  const lsRemote =
    receipt?.lsRemote && resolution.commitSha && row.use.owner && row.use.repo
      ? `git ls-remote https://github.com/${row.use.owner}/${row.use.repo} "${receipt.lsRemote}"`
      : null;
  const copyLsRemote = async () => {
    if (!lsRemote) return;
    if (await copyTextToClipboard(lsRemote)) {
      setCopied(true);
      toast({ title: "Check command copied", description: "Run it to verify this pin yourself" });
    } else {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div
      data-testid="receipt-item"
      data-status={resolution.status}
      data-ref={`${row.use.owner}/${row.use.repo}@${row.use.ref}`}
      className="mt-2 rounded border border-line bg-sunk/70 px-3 py-2"
    >
      <p data-testid="receipt-chain" className="break-all font-mono text-[11px] leading-relaxed text-ink-2">
        {chain.length === 0
          ? "No API call was made for this ref."
          : chain
              .map((hop) => `${hop.endpoint}${hop.sha ? ` → ${hop.sha.slice(0, 12)}…` : ""}${hop.httpStatus && hop.sha ? ` (${hop.httpStatus})` : ""}`)
              .join("  →  ")}
      </p>
      {resolution.commitSha ? (
        <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink">
          commit {resolution.commitSha}
          {receipt?.dereferencedFrom ? <span className="text-ink-2"> · via tag object {receipt.dereferencedFrom}</span> : null}
        </p>
      ) : null}
      {resolution.commitSha ? (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          The pinned SHA is a point-in-time snapshot: the tag can still move later. Re-resolve when you update.
        </p>
      ) : (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {sentence(receipt?.note ?? "This ref was not resolved")} It is still unpinned; everything else on this page is
          unaffected.
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-3">
        {lsRemote ? (
          <button
            type="button"
            onClick={copyLsRemote}
            className="inline-flex max-w-full items-center gap-1.5 rounded text-left text-seal hover:underline"
            aria-label={`Copy check command: ${lsRemote}`}
          >
            {copied ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="break-all">{lsRemote}</span>
          </button>
        ) : null}
        <span data-testid="receipt-resolved-at">resolvedAt {receipt?.resolvedAt ?? "—"}</span>
      </div>
    </div>
  );
}

/** Capitalised, full-stopped: engine notes are fragments. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}
