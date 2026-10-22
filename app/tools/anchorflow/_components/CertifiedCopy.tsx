"use client";

import React from "react";
import { Check, Copy, LoaderCircle, Pin, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ANALYZE_TIMEOUT_ERROR, RATE_LIMIT_RESERVE } from "../_lib/constants";
import { buildLedger, buildVerdict, type Verdict } from "../_lib/ledger";
import type { RateLimitState, ToolMetrics } from "../_lib/types";
import { useToolStore } from "../_store/useToolStore";
import { Ledger } from "./Ledger";
import { ReportTabs, useCopy } from "./ReportTabs";

/**
 * The certified copy: the answer half of the workstation. One sentence and one
 * next step lead (resolve, copy, or nothing to do), the uses ledger follows,
 * and the deeper report sits in four tabs. Loading says loading; a parse error
 * says where; a rate limit says when it resets. Never zeros while working.
 */
export function CertifiedCopy() {
  const source = useToolStore((s) => s.source);
  const uses = useToolStore((s) => s.report.uses);
  const resolutions = useToolStore((s) => s.report.resolutions);
  const findings = useToolStore((s) => s.report.findings);
  const rewrittenYaml = useToolStore((s) => s.report.rewrittenYaml);
  const metrics = useToolStore((s) => s.metrics);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const isWorkerAvailable = useToolStore((s) => s.isWorkerAvailable);
  const rateLimit = useToolStore((s) => s.rateLimit);

  const rows = React.useMemo(() => buildLedger(uses, resolutions), [uses, resolutions]);
  const verdict = React.useMemo(() => buildVerdict(rows, findings), [rows, findings]);
  const hasReport = rewrittenYaml !== null && !errorMessage;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-6">
        <h2 className="text-sm font-bold text-ink">Certified copy</h2>
        <p className="figures font-mono text-[11px] text-ink-3" aria-live="off">
          {isProcessing ? (
            <span className="text-ink-2">checking…</span>
          ) : hasReport ? (
            <>
              computed in this tab · {Math.max(1, Math.round(metrics.parseTimeMs))} ms
              {isWorkerAvailable === false ? " · main thread" : ""}
            </>
          ) : null}
        </p>
      </div>

      <div className="px-4 pb-6 pt-5 sm:px-6">
        {errorMessage ? (
          <ErrorState message={errorMessage} />
        ) : !source ? (
          <p className="max-w-prose text-[15px] leading-relaxed text-ink-2">
            Paste a workflow on the left. The certified copy appears here as you type: what is pinned, what moves,
            and what else is risky.
          </p>
        ) : !hasReport ? (
          <CheckingState />
        ) : (
          <>
            {isWorkerAvailable === false && (
              <Notice tone="major">
                The background worker isn&rsquo;t available in this browser, so the check runs on the main thread. Same
                engine, same results.
              </Notice>
            )}
            <UsesCapNotice metrics={metrics} />
            <VerdictBlock verdict={verdict} rewrittenYaml={rewrittenYaml ?? ""} />
            <RateLimitBanner budget={rateLimit} />
            <Ledger rows={rows} source={source} hasResolutions={resolutions.length > 0} />
            <ReportTabs source={source} />
          </>
        )}
      </div>
    </div>
  );
}

function CheckingState() {
  return (
    <div role="status" className="flex items-start gap-3">
      <LoaderCircle className="mt-1 h-4 w-4 shrink-0 animate-spin text-seal motion-reduce:animate-none" aria-hidden="true" />
      <div>
        <p className="text-[20px] font-bold leading-snug text-ink">Checking your workflow…</p>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-2">
          The checker loads once, then runs on every edit. On a slow connection the first check can take a few
          seconds.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const isBudget = message === ANALYZE_TIMEOUT_ERROR;
  return (
    <div role="alert" className="max-w-prose">
      <p className="flex items-start gap-2 text-[20px] font-bold leading-snug text-ink">
        <TriangleAlert className="mt-1 h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
        {isBudget ? "This workflow took too long to check." : "This isn’t a workflow Anchorflow can read yet."}
      </p>
      <p className="mt-2 font-mono text-[12px] leading-relaxed text-critical">{message}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        {isBudget
          ? "Nothing was uploaded and nothing is lost. Try again, or paste one workflow file at a time rather than several joined together."
          : "Fix the YAML on the left and the check reruns as you type. Indentation is the usual culprit."}
      </p>
    </div>
  );
}

function VerdictBlock({ verdict, rewrittenYaml }: { verdict: Verdict; rewrittenYaml: string }) {
  const autoResolve = useToolStore((s) => s.autoResolve);
  const setAutoResolve = useToolStore((s) => s.setAutoResolve);
  const isProcessing = useToolStore((s) => s.isProcessing);
  const resolveStatus = useToolStore((s) => s.resolveStatus);
  const requestResolve = useToolStore((s) => s.requestResolve);
  const resolving = resolveStatus === "running";
  const { copied, copy } = useCopy();
  const n = verdict.resolvable;

  const riskTone =
    verdict.riskCounts.error > 0 ? "text-critical" : verdict.riskCounts.warn > 0 ? "text-major" : "text-ink-2";

  return (
    <div className="pb-5">
      <p className="text-[21px] font-bold leading-snug tracking-[-0.01em] text-ink sm:text-[23px]">{verdict.headline}</p>
      <p className={cn("mt-1 text-[15px] font-semibold", riskTone)}>{verdict.risk}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {verdict.next === "resolve" || resolving ? (
          <Button
            variant="primary"
            onClick={requestResolve}
            disabled={isProcessing || resolving || n === 0}
            aria-busy={resolving}
            aria-label={resolving ? "Resolving refs" : "Resolve every ref to a commit SHA"}
            data-testid="resolve-pin-button"
            data-status={resolveStatus}
          >
            {resolving ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Pin className="h-4 w-4" aria-hidden="true" />
            )}
            {resolving ? `Looking up ${n} ${n === 1 ? "ref" : "refs"}…` : `Resolve & pin ${n} ${n === 1 ? "ref" : "refs"}`}
          </Button>
        ) : null}
        <Button
          variant={verdict.next === "copy" ? "primary" : "outline"}
          onClick={() => copy("file", rewrittenYaml, "Pinned file copied", "Paste it over your workflow")}
          disabled={!rewrittenYaml}
        >
          {copied === "file" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {verdict.pinnedNow > 0 ? "Copy pinned file" : "Copy file"}
        </Button>
      </div>

      {verdict.next === "resolve" && (
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-2">
          Looks up {n === 1 ? "this ref" : `these ${n} refs`} on api.github.com from your browser, read-only and without
          a token. Only the action names and tags are sent, never your workflow.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2.5">
        <Switch
          id="auto-resolve-toggle"
          checked={autoResolve}
          onCheckedChange={setAutoResolve}
          aria-label="Auto-resolve refs against api.github.com"
        />
        <label htmlFor="auto-resolve-toggle" className="cursor-pointer select-none text-[13px] text-ink-2">
          Re-pin automatically after each edit
        </label>
      </div>
    </div>
  );
}

function Notice({ tone, children, ...rest }: { tone: "major" | "critical"; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      role="status"
      className={cn(
        "mb-4 flex gap-2.5 rounded border px-3 py-2.5 text-sm leading-relaxed text-ink",
        tone === "major" ? "border-major/50 bg-major/10" : "border-critical/50 bg-critical/10"
      )}
      {...rest}
    >
      <TriangleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "major" ? "text-major" : "text-critical")} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Spent quota: friendly, specific, never a blocker. */
function RateLimitBanner({ budget }: { budget: RateLimitState }) {
  const [now] = React.useState(() => Date.now());
  if (budget.remaining > RATE_LIMIT_RESERVE) return null;
  const reset = budget.resetAt > 0 ? `in ${countdown(budget.resetAt, now)}` : "when the next hourly window opens";
  return (
    <Notice
      tone="major"
      aria-label="GitHub API rate limit"
      data-testid="rate-limit-banner"
      data-remaining={budget.remaining}
    >
      <p className="font-semibold">
        {budget.remaining === 0
          ? "GitHub’s hourly API limit is reached for your network."
          : "GitHub’s hourly API limit for your network is nearly spent."}
      </p>
      <p className="text-ink-2">
        <span className="figures font-mono text-[12px]">
          {budget.remaining} of {budget.limit} left
        </span>
        , resets {reset}. Refs not looked up stay unpinned; press Resolve &amp; pin again after the reset. The
        offline report is still complete.
      </p>
    </Notice>
  );
}

/** The `uses:` scan cap, reported rather than hidden. */
function UsesCapNotice({ metrics }: { metrics: ToolMetrics }) {
  if (!metrics.usesCapHit) return null;
  const unscanned = Math.max(0, metrics.usesSeen - metrics.usesScanned);
  return (
    <Notice
      tone="major"
      aria-label="Uses scan cap"
      data-testid="uses-cap-notice"
      data-seen={metrics.usesSeen}
      data-scanned={metrics.usesScanned}
    >
      <p className="font-semibold">
        Checked the first {metrics.usesScanned.toLocaleString("en-US")} of {metrics.usesSeen.toLocaleString("en-US")} uses:
        lines.
      </p>
      <p className="text-ink-2">
        The scan stops at 2,000 so the page stays responsive; the other {unscanned.toLocaleString("en-US")} were not
        checked. Split the file to check the rest.
      </p>
    </Notice>
  );
}

function countdown(resetAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((resetAt - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`;
}
