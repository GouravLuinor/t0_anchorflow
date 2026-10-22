"use client";

import React from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { cn, copyTextToClipboard } from "@/lib/utils";
import { SEVERITY_BANDS, countBySeverity, formatFinding, formatFindings, sortFindings } from "../_lib/findings";
import { effectiveJobGrants } from "../_lib/grantTable";
import { lineOfOffset } from "../_lib/textMetrics";
import type { Finding, GrantTable, Severity, UnifiedDiff } from "../_lib/types";
import { useToolStore } from "../_store/useToolStore";

/** Findings visible before "Show all" — keeps phones short. */
const COLLAPSED_FINDINGS = 4;

/**
 * One fixed magnitude ramp: the grade is carried by the mark's SIZE, its
 * colour and a word, so nothing depends on colour alone.
 */
const GRADE: Record<Severity, { word: string; text: string; mark: string; size: string }> = {
  error: { word: "Critical", text: "text-critical", mark: "bg-critical", size: "h-3 w-3" },
  warn: { word: "Major", text: "text-major", mark: "bg-major", size: "h-2.5 w-2.5" },
  minor: { word: "Minor", text: "text-ink-2", mark: "bg-ink-2", size: "h-2 w-2" },
  info: { word: "Info", text: "text-ink-3", mark: "bg-ink-3", size: "h-1.5 w-1.5" },
};

export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), resetMs);
    return () => window.clearTimeout(t);
  }, [copied, resetMs]);
  const copy = React.useCallback(async (key: string, text: string, title: string, description?: string) => {
    if (await copyTextToClipboard(text)) {
      setCopied(key);
      toast({ title, description });
    } else {
      toast({ title: "Copy failed", description: "Your browser blocked the clipboard", variant: "destructive" });
    }
  }, []);
  return { copied, copy };
}

export function ReportTabs({ source }: { source: string }) {
  const findings = useToolStore((s) => s.report.findings);
  const permissions = useToolStore((s) => s.report.permissions);
  const rewrittenYaml = useToolStore((s) => s.report.rewrittenYaml);
  const diff = useToolStore((s) => s.report.diff);
  const changed = diff?.changed ?? 0;
  const ordered = React.useMemo(() => sortFindings(findings), [findings]);

  return (
    <Tabs defaultValue="findings" className="mt-6">
      <TabsList aria-label="Report">
        <TabsTrigger value="findings">
          Findings <span className="figures font-mono text-[12px] text-ink-3">{ordered.length}</span>
        </TabsTrigger>
        <TabsTrigger value="grants">Token grants</TabsTrigger>
        <TabsTrigger value="file">Pinned file</TabsTrigger>
        <TabsTrigger value="diff">
          Diff{" "}
          <span data-testid="diff-changed-count" className="figures font-mono text-[12px] text-ink-3">
            {changed}<span className="hidden sm:inline"> {changed === 1 ? "change" : "changes"}</span>
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="findings" forceMount className="data-[state=inactive]:hidden">
        <FindingsList findings={ordered} source={source} />
      </TabsContent>
      <TabsContent value="grants" forceMount className="data-[state=inactive]:hidden">
        <GrantTableView grants={permissions} />
      </TabsContent>
      <TabsContent value="file" forceMount className="data-[state=inactive]:hidden">
        <PinnedFile rewrittenYaml={rewrittenYaml ?? ""} source={source} changed={changed} />
      </TabsContent>
      <TabsContent value="diff" forceMount className="data-[state=inactive]:hidden">
        <DiffView diff={diff} />
      </TabsContent>
    </Tabs>
  );
}

// ── Findings ────────────────────────────────────────────────────────────────

function FindingsList({ findings, source }: { findings: Finding[]; source: string }) {
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const [showAll, setShowAll] = React.useState(false);
  const { copied, copy } = useCopy();
  const visible = showAll ? findings : findings.slice(0, COLLAPSED_FINDINGS);
  // On a phone the reasoning folds behind "Why"; the title, place and fix stay.
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleWhy = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-label="Security findings">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="sr-only">Findings</h3>
        <p data-testid="findings-counts" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {findings.length === 0 ? (
            <span data-testid="findings-clear" className="font-semibold text-seal">
              No findings
            </span>
          ) : (
            SEVERITY_BANDS.filter((b) => counts[b.severity] > 0).map((b) => (
              <span key={b.severity} data-testid={`findings-count-${b.label}`} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("rounded-full", GRADE[b.severity].mark, GRADE[b.severity].size)} />
                <span className={cn("font-semibold", GRADE[b.severity].text)}>{b.label}</span>
                <span className="figures font-mono text-[12px] text-ink-2">{counts[b.severity]}</span>
              </span>
            ))
          )}
        </p>
        {findings.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            data-testid="copy-all-findings"
            onClick={() =>
              copy("all", formatFindings(findings), "All findings copied", `${findings.length} finding${findings.length === 1 ? "" : "s"}`)
            }
          >
            {copied === "all" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            Copy all
          </Button>
        )}
      </div>

      {findings.length === 0 ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-2">
          The permission, injection, trigger and checkout audits found nothing to report in this workflow.
        </p>
      ) : (
        <ul data-testid="findings-report" className="mt-3 divide-y divide-line border-y border-line">
          {visible.map((f) => (
            <li
              key={f.id}
              data-testid="finding-item"
              data-severity={f.severity}
              data-category={f.category}
              data-finding-id={f.id}
              className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-3"
            >
              <span className="flex h-5 items-center justify-center" aria-hidden="true">
                <span className={cn("rounded-full", GRADE[f.severity].mark, GRADE[f.severity].size)} />
              </span>
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug text-ink">
                    <span className={cn("mr-1.5 text-[13px]", GRADE[f.severity].text)}>{GRADE[f.severity].word}</span>
                    {f.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => copy(f.id, formatFinding(f), "Finding copied")}
                    aria-label={`Copy finding ${f.id}`}
                    data-testid="copy-finding"
                    className="shrink-0 rounded p-1 text-ink-3 transition-colors duration-150 hover:bg-sunk hover:text-ink"
                  >
                    {copied === f.id ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                  {f.start === null ? f.where : `line ${lineOfOffset(source, f.start)} · ${f.where}`}
                </p>
                <div id={`why-${f.id}`} className={opened.has(f.id) ? undefined : "hidden sm:block"}>
                  <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-2">{f.detail}</p>
                  {f.evidence ? (
                    <p className="mt-1.5 break-all rounded bg-sunk px-2 py-1 font-mono text-[11px] leading-relaxed text-ink">{f.evidence}</p>
                  ) : null}
                </div>
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink">
                  <span className="font-bold text-seal">Fix: </span>
                  {f.remediation}
                </p>
                <button
                  type="button"
                  onClick={() => toggleWhy(f.id)}
                  aria-expanded={opened.has(f.id)}
                  aria-controls={`why-${f.id}`}
                  className="mt-1 inline-flex items-center gap-1 rounded py-1.5 text-[13px] font-semibold text-seal hover:underline sm:hidden"
                >
                  {opened.has(f.id) ? "Hide why" : "Why"}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", opened.has(f.id) && "rotate-180")} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {findings.length > COLLAPSED_FINDINGS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-1 inline-flex items-center gap-1 rounded py-2 text-sm font-semibold text-seal hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${findings.length} findings`}
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", showAll && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

// ── Token grants ────────────────────────────────────────────────────────────

function GrantTableView({ grants }: { grants: GrantTable | null }) {
  if (!grants) {
    return <p className="text-sm text-ink-2">The grant table appears once the workflow parses.</p>;
  }

  const topLine = grants.top
    ? grants.top.all
      ? `${grants.top.all}-all`
      : Object.keys(grants.top.scopes).length === 0
        ? "{} (no scopes)"
        : Object.entries(grants.top.scopes)
            .map(([scope, level]) => `${scope}: ${level}`)
            .join(", ")
    : null;

  return (
    <section aria-label="Token grant table">
      <p className="max-w-prose text-sm leading-relaxed text-ink-2">
        {grants.unset ? (
          <>
            <span className="font-semibold text-major">No permissions block.</span> Every job gets the repository&rsquo;s
            default token, which is often read and write.
          </>
        ) : topLine ? (
          <>
            Top-level block: <span className="font-mono text-[12px] text-ink">{topLine}</span>. Scopes marked{" "}
            <span className="font-semibold text-ink">top</span> come from it; <span className="font-semibold text-ink">job</span> from
            the job&rsquo;s own block.
          </>
        ) : (
          "No top-level block; each job sets its own."
        )}
      </p>
      <table data-testid="grant-table" className="mt-3 w-full border-y border-line text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-3">
            <th scope="col" className="py-2 pr-4 font-semibold">Job</th>
            <th scope="col" className="py-2 font-semibold">GITHUB_TOKEN can</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {grants.jobs.map((job) => {
            const rows = effectiveJobGrants({ id: job.jobId, permissions: job.block }, grants.top);
            return (
              <tr key={job.jobId} data-testid="grant-row" data-job={job.jobId} className="align-top">
                <th scope="row" className="py-2.5 pr-4 font-mono text-[12px] font-normal text-ink">
                  {job.jobId}
                  {!job.block && <span className="block font-sans text-[12px] text-ink-3">inherits top-level</span>}
                </th>
                <td className="py-2.5">
                  {rows.length === 0 ? (
                    <span className="text-ink-3">nothing</span>
                  ) : (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {rows.map((row) => (
                        <li
                          key={`${row.scope}-${row.source}`}
                          data-testid="grant-scope"
                          data-scope={row.scope}
                          data-level={row.level}
                          className="font-mono text-[12px]"
                        >
                          <span className="text-ink">{row.scope}</span>
                          <span className={row.level === "write" ? "font-semibold text-critical" : row.level === "read" ? "text-ink-2" : "text-ink-3"}>
                            : {row.level}
                          </span>
                          <span className="pl-1 font-sans text-[11px] text-ink-3">{row.source === "top" ? "top" : "job"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ── Pinned file: two whole sides ────────────────────────────────────────────

function PinnedFile({ rewrittenYaml, source, changed }: { rewrittenYaml: string; source: string; changed: number }) {
  const [side, setSide] = React.useState<"pinned" | "original">("pinned");
  const { copied, copy } = useCopy();
  const text = side === "pinned" ? rewrittenYaml : source;

  return (
    <section aria-label="Rewritten workflow YAML">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Which side" className="inline-flex rounded border border-line-strong p-0.5">
          {(["pinned", "original"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={side === value}
              onClick={() => setSide(value)}
              className={cn(
                "rounded px-3 py-1 text-[13px] font-semibold transition-colors duration-150",
                side === value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
              )}
            >
              {value === "pinned" ? "Pinned" : "As pasted"}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-ink-2">
          {changed > 0 ? `${changed} uses: ${changed === 1 ? "line" : "lines"} changed; every other byte is yours.` : "Identical to your file until refs are pinned."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!rewrittenYaml}
          onClick={() => copy("file", rewrittenYaml, "Pinned file copied", "Paste it over your workflow")}
        >
          {copied === "file" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          Copy pinned file
        </Button>
      </div>
      <pre
        data-testid={side === "pinned" ? "diagnostic-echo" : "original-echo"}
        aria-label={side === "pinned" ? "Pinned workflow YAML" : "Workflow as pasted"}
        className="mt-3 max-h-[28rem] overflow-auto rounded border border-line bg-sunk/70 px-4 py-3 font-mono text-[12px] leading-[1.75] text-ink"
      >
        {text}
      </pre>
    </section>
  );
}

// ── Diff ────────────────────────────────────────────────────────────────────

function DiffView({ diff }: { diff: UnifiedDiff | null }) {
  const lines = diff?.lines ?? [];
  const { copied, copy } = useCopy();
  const patch = lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`).join("\n");

  return (
    <section aria-label="Unified diff">
      {lines.length === 0 ? (
        <p data-testid="diff-empty" className="max-w-prose text-sm leading-relaxed text-ink-2">
          No changes yet. Resolve &amp; pin rewrites the moving refs, and the diff of exactly those lines appears here.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <p className="text-[13px] text-ink-2">Only the uses: values change. Paste this into a PR description or review.</p>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => copy("diff", patch, "Diff copied")}>
              {copied === "diff" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              Copy diff
            </Button>
          </div>
          <pre className="mt-3 max-h-[28rem] overflow-auto rounded border border-line bg-sunk/70 py-2 font-mono text-[12px] leading-[1.75]">
            {lines.map((line, i) => (
              <div
                key={`${line.kind}-${line.beforeLine ?? "x"}-${line.afterLine ?? "x"}-${i}`}
                className={cn(
                  "whitespace-pre-wrap break-all px-4",
                  line.kind === "add" && "bg-seal/10 text-seal",
                  line.kind === "del" && "bg-critical/10 text-critical",
                  line.kind === "context" && "text-ink-3"
                )}
              >
                <span aria-hidden="true" className="select-none pr-2">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                </span>
                <span className="sr-only">{line.kind === "add" ? "added: " : line.kind === "del" ? "removed: " : ""}</span>
                {line.text}
              </div>
            ))}
          </pre>
        </>
      )}
    </section>
  );
}
