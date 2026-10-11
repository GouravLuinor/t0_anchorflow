// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the ONE canonical findings array: order, bands and copy text.
// Pure, no IO.
//
// Every audit emits `Finding[]`; the pipeline concatenates them and sorts them
// into the canonical deterministic order (SPEC §9 AC-10):
//
//   1. ascending source offset (`Finding.start`; `null` sorts LAST),
//   2. then `category` (alphabetical),
//   3. then `id` — `<category>:<jobId>:<stepIndex|job>:<n>`, a pure function of
//      the finding's structural position, so no run-to-run jitter is possible.
//
// The four severity grades render as four bands in the DiagnosticPane
// (critical · major · minor · info) with the Matchlight semantic colours:
// rose = critical/error, amber = major/warn, violet = minor (secondary),
// zinc = info, lime = the all-clear state.
// ─────────────────────────────────────────────────────────────────────────────

import type { Finding, Severity } from "./types";

/** The four finding bands, worst-first. */
export const SEVERITY_BANDS: ReadonlyArray<{
  severity: Severity;
  label: string;
}> = [
  { severity: "error", label: "critical" },
  { severity: "warn", label: "major" },
  { severity: "minor", label: "minor" },
  { severity: "info", label: "info" },
];

/** Grade rank, worst-first — the ordering the summary chips keep. */
const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warn: 1,
  minor: 2,
  info: 3,
};

/** Rank of a severity (0 = critical). Unknown grades sort last, never throw. */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.info;
}

/** A missing offset sorts after every real one, and never between two. */
const NO_OFFSET = Number.MAX_SAFE_INTEGER;

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Sorts findings into the canonical deterministic order (AC-10). Pure: the
 * input array is never mutated, and the comparator is a total order over
 * (offset, category, id), so the result is stable across runs and engines.
 */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byOffset = (a.start ?? NO_OFFSET) - (b.start ?? NO_OFFSET);
    if (byOffset !== 0) return byOffset;
    const byCategory = compareStrings(a.category, b.category);
    if (byCategory !== 0) return byCategory;
    return compareStrings(a.id, b.id);
  });
}

/** Counts per severity grade — the summary chip row. */
export function countBySeverity(
  findings: readonly Finding[]
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    error: 0,
    warn: 0,
    minor: 0,
    info: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** The single worst grade present, or null for an empty report. */
export function worstSeverity(findings: readonly Finding[]): Severity | null {
  let worst: Severity | null = null;
  for (const finding of findings) {
    if (worst === null || severityRank(finding.severity) < severityRank(worst)) {
      worst = finding.severity;
    }
  }
  return worst;
}

/** Longest evidence kept in a finding's `evidence` field. */
const EVIDENCE_LIMIT = 160;

/** Trims an expression for display without ever hiding which one it was. */
export function evidenceText(expression: string): string {
  const flat = expression.replace(/\s+/g, " ").trim();
  if (flat.length <= EVIDENCE_LIMIT) return flat;
  return `${flat.slice(0, EVIDENCE_LIMIT - 1)}…`;
}

/** One finding as copyable plain text (the per-finding copy payload). */
export function formatFinding(finding: Finding): string {
  const lines = [
    `[${finding.severity}] ${finding.title}`,
    `where: ${finding.where}`,
  ];
  if (finding.detail) lines.push(`detail: ${finding.detail}`);
  if (finding.evidence) lines.push(`expression: ${finding.evidence}`);
  lines.push(`fix: ${finding.remediation}`);
  return lines.join("\n");
}

/**
 * The whole findings report as copyable plain text (the "Copy all findings"
 * payload): a severity summary header, then every finding in canonical order.
 */
export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "Anchorflow findings — none. No findings were produced for this workflow.";
  }

  const counts = countBySeverity(findings);
  const summary = SEVERITY_BANDS.map(
    (band) => `${band.label}: ${counts[band.severity]}`
  ).join(" · ");

  const header = `Anchorflow findings — ${findings.length} total (${summary})`;
  const body = findings.map(formatFinding).join("\n\n");
  return `${header}\n\n${body}`;
}
