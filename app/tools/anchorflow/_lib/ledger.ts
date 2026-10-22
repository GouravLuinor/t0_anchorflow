// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the certified-copy ledger and its one-line verdict (pure).
//
// Joins each classified `uses:` node with its resolution (when Phase B ran) and
// names its state in plain words, then condenses the whole workflow into ONE
// sentence and ONE next step: resolve, copy, or nothing to do. The UI renders
// these values; it never re-derives a state on its own.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassifiedUses, Finding, Resolution, Severity } from "./types";

export type LedgerState =
  /** Already a 40-hex (or sha256) commit in the source. */
  | "pinned"
  /** Pinned by this run's resolve. */
  | "pinned-now"
  /** A branch or floating major (`@main`, `@v4`). */
  | "moving"
  /** A dotted tag (`@v4.2.0`): fixed by convention, still re-pointable. */
  | "tag"
  /** Phase B ran but could not pin it (not found, rate limit, offline). */
  | "unresolved"
  /** The path-safety gate refused it before any request. */
  | "refused"
  | "local"
  | "docker"
  | "invalid";

export interface LedgerRow {
  use: ClassifiedUses;
  resolution: Resolution | null;
  state: LedgerState;
  /** Short status words for the row. */
  label: string;
  /** The commit this row is sealed with, when it has one. */
  sha: string | null;
}

const UNRESOLVED_LABEL: Partial<Record<Resolution["status"], string>> = {
  "unknown-ref": "Not found on GitHub",
  "rate-limited": "Not looked up · rate limit",
  "network-error": "Not looked up · offline",
};

export function ledgerRow(use: ClassifiedUses, resolution: Resolution | null): LedgerRow {
  const row = (state: LedgerState, label: string, sha: string | null = null): LedgerRow => ({
    use,
    resolution,
    state,
    label,
    sha,
  });

  switch (use.cls) {
    case "sha40":
      return row("pinned", "Pinned", use.ref);
    case "sha256":
      return row("pinned", "Pinned (sha256)", use.ref);
    case "local":
      return row("local", "Local action · nothing to pin");
    case "docker":
      return row("docker", "Docker image · not resolved here");
    case "invalid":
      return row("invalid", "Can't read this uses:");
    case "remoteRef":
      break;
  }

  if (resolution) {
    if (resolution.status === "resolved" && resolution.commitSha) {
      return row("pinned-now", "Pinned now", resolution.commitSha);
    }
    if (resolution.status === "unsafe-ref") return row("refused", "Refused · unsafe ref");
    const label = UNRESOLVED_LABEL[resolution.status];
    if (label) return row("unresolved", label);
  }

  return use.moving ? row("moving", "Moving ref · not pinned") : row("tag", "Tag · not pinned");
}

/** One row per `uses:` node, in source order, joined to its resolution by id. */
export function buildLedger(
  uses: readonly ClassifiedUses[],
  resolutions: readonly Resolution[]
): LedgerRow[] {
  const byId = new Map(resolutions.map((r) => [r.ref.id, r]));
  return uses.map((use) => ledgerRow(use, byId.get(use.id) ?? null));
}

/** True for a row Resolve & pin can still act on. */
export function isResolvableRow(row: LedgerRow): boolean {
  return (
    row.state === "moving" ||
    row.state === "tag" ||
    (row.state === "unresolved" && row.resolution?.status !== "unknown-ref")
  );
}

/** Categories the ledger already shows row by row; the verdict skips them. */
const LEDGER_CATEGORIES = new Set<Finding["category"]>([
  "unpinned-uses",
  "moving-ref",
  "resolution",
]);

const SEVERITY_WORD: Record<Severity, string> = {
  error: "critical",
  warn: "major",
  minor: "minor",
  info: "info",
};

export type NextStep = "resolve" | "copy" | "none";

export interface Verdict {
  /** The sentence about pinning. */
  headline: string;
  /** The sentence about everything else the audit found. */
  risk: string;
  next: NextStep;
  /** How many rows Resolve & pin would look up. */
  resolvable: number;
  pinnedNow: number;
  remote: number;
  /** Non-ledger findings by severity, for the risk sentence's colours. */
  riskCounts: Record<Severity, number>;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildVerdict(rows: readonly LedgerRow[], findings: readonly Finding[]): Verdict {
  const remote = rows.filter((r) => r.use.cls === "remoteRef").length;
  const pinnedNow = rows.filter((r) => r.state === "pinned-now").length;
  const resolvable = rows.filter(isResolvableRow).length;
  const stuck = rows.filter((r) => r.state === "unresolved" || r.state === "refused").length;

  let headline: string;
  let next: NextStep;
  if (rows.length === 0) {
    headline = "No actions to pin in this workflow.";
    next = "none";
  } else if (resolvable > 0) {
    const unpinned = rows.filter(
      (r) => r.use.cls === "remoteRef" && r.state !== "pinned-now"
    ).length;
    headline =
      pinnedNow > 0
        ? `Pinned ${pinnedNow} of ${remote}. ${plural(resolvable, "ref is", "refs are")} still waiting.`
        : `${unpinned} of ${plural(rows.length, "action", "actions")} ${unpinned === 1 ? "isn't" : "aren't"} pinned to a commit.`;
    next = "resolve";
  } else if (pinnedNow > 0) {
    headline =
      stuck > 0
        ? `Pinned ${pinnedNow} of ${remote}. ${plural(stuck, "ref", "refs")} couldn't be pinned.`
        : `Pinned ${plural(pinnedNow, "action", "actions")} to commit SHAs.`;
    next = "copy";
  } else if (stuck > 0) {
    headline = `${plural(stuck, "ref", "refs")} couldn't be pinned.`;
    next = "none";
  } else {
    headline = "Every action is already pinned to a commit.";
    next = "none";
  }

  const riskCounts: Record<Severity, number> = { error: 0, warn: 0, minor: 0, info: 0 };
  for (const f of findings) if (!LEDGER_CATEGORIES.has(f.category)) riskCounts[f.severity] += 1;
  const parts = (["error", "warn", "minor"] as const)
    .filter((s) => riskCounts[s] > 0)
    .map((s) => `${riskCounts[s]} ${SEVERITY_WORD[s]}`);
  const total = riskCounts.error + riskCounts.warn + riskCounts.minor;
  const risk =
    total === 0
      ? "No permission, injection or trigger problems found."
      : `${joinWords(parts)} ${total === 1 ? "finding" : "findings"} to fix.`;

  return { headline, risk, next, resolvable, pinnedNow, remote, riskCounts };
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
