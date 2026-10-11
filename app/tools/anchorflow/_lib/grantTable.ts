// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the GITHUB_TOKEN grant table (ARCH §3.5 · SPEC §4 F5).
// Pure, no IO.
//
// A workflow's effective grant for one scope is resolved the way GitHub
// resolves it: a job's own `permissions:` block overrides the top-level block
// PER SCOPE, `write-all` / `read-all` is a shorthand for every known scope, an
// omitted scope is absent (not "none"), and a workflow with no block at all
// UNSETS the token down to the repository/org default.
//
// The scope table below is the domain knowledge the audit quotes: every row
// says what the scope actually grants, so a finding never asserts "write" in
// the abstract.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  GrantRow,
  GrantTable,
  JobNode,
  RawPermissionBlock,
  WorkflowModel,
} from "./types";

/** The canonical scope order — the order the grant table renders in. */
export const PERMISSION_SCOPES: readonly string[] = [
  "actions",
  "attestations",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "repository-projects",
  "security-events",
  "statuses",
];

/**
 * What each scope actually grants, in plain English. This is the copy every
 * permission finding quotes, so a reader sees "contents: write — push commits,
 * tags and releases to this repository", never a bare scope name.
 */
export const SCOPE_SEMANTICS: Readonly<Record<string, string>> = {
  actions: "manage workflow runs and their artifacts (read logs, run wait, cancel)",
  attestations: "write artifact attestations (build provenance) for this repository",
  checks: "create and update check runs and check suites",
  contents: "read repository files; write pushes commits, tags and releases",
  deployments: "create deployments and deployment statuses",
  discussions: "create and edit discussions and their categories",
  "id-token": "mint an OIDC token for this job (used by cloud logins)",
  issues: "read issues; write creates, edits, closes and comments",
  models: "call GitHub Models (the hosted inference API)",
  packages: "read packages; write uploads and deletes container/package versions",
  pages: "read GitHub Pages; write pushes a Pages build",
  "pull-requests": "read pull requests; write opens, edits, merges and reviews",
  "repository-projects": "manage classic repository projects",
  "security-events": "read and write code scanning, secret scanning and Dependabot alerts",
  statuses: "create commit statuses",
};

/** The semantics of any scope, known or misspelled. */
export function scopeSemantics(scope: string): string {
  return (
    SCOPE_SEMANTICS[scope] ??
    `unknown scope "${scope}" — not a GitHub-recognized token permission`
  );
}

/** Human label for one row of the grant table. */
export function describeGrant(scope: string, level: "read" | "write" | "none"): string {
  return `${scope}: ${level} — ${scopeSemantics(scope)}`;
}

function isLevel(value: unknown): value is "read" | "write" | "none" {
  return value === "read" || value === "write" || value === "none";
}

/**
 * Normalises ANY raw `permissions:` value into a block (ARCH §3.5's
 * `parsePermissions` seam):
 *
 *   "write-all" / "read-all"  → the `all` shorthand
 *   { contents: read, … }      → the per-scope map
 *   anything else              → null (absent, unparseable)
 *
 * A block may carry BOTH the shorthand and per-scope overrides — GitHub's own
 * YAML allows `all:` plus keys, and the parser's `parsePermissionBlock` can
 * produce exactly that shape for a map.
 */
export function parsePermissions(raw: unknown): RawPermissionBlock | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "write-all") return { all: "write", scopes: {} };
    if (text === "read-all") return { all: "read", scopes: {} };
    return null;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const scopes: Record<string, "read" | "write" | "none"> = {};

  // The parser's own block shape nests its map under `scopes`; YAML writes the
  // scopes as the map's own keys. Both are accepted, so the function is
  // idempotent on a block it produced itself.
  const nested = record.scopes;
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [scope, value] of Object.entries(nested as Record<string, unknown>)) {
      if (isLevel(value)) scopes[scope] = value;
    }
  } else {
    for (const [key, value] of Object.entries(record)) {
      if (key === "all") continue;
      if (isLevel(value)) scopes[key] = value;
    }
  }

  const all = record.all;
  if (all === "write" || all === "read") return { all, scopes };
  if (Object.keys(scopes).length === 0 && !("scopes" in record)) return null;
  return { scopes };
}

/**
 * Expands a block to one level per scope. `read-all` / `write-all` covers every
 * known scope; explicit scopes then override the shorthand per scope, which is
 * exactly GitHub's own resolution order.
 */
export function expandBlock(
  block: RawPermissionBlock | null
): Record<string, "read" | "write" | "none"> {
  const out: Record<string, "read" | "write" | "none"> = {};
  if (!block) return out;
  if (block.all) {
    for (const scope of PERMISSION_SCOPES) out[scope] = block.all;
  }
  for (const [scope, level] of Object.entries(block.scopes)) {
    out[scope] = level;
  }
  return out;
}

/** The levels a block grants, in canonical scope order. */
export function blockScopes(block: RawPermissionBlock | null): string[] {
  const expanded = expandBlock(block);
  const known = PERMISSION_SCOPES.filter((scope) => scope in expanded);
  const unknown = Object.keys(expanded)
    .filter((scope) => !PERMISSION_SCOPES.includes(scope))
    .sort();
  return [...known, ...unknown];
}

/**
 * The job's EFFECTIVE grant: its own block first (per scope), falling back to
 * the top-level block. The result is keyed by scope, with the winner's source.
 */
export function effectiveJobGrants(
  job: Pick<JobNode, "id" | "permissions">,
  top: RawPermissionBlock | null
): GrantRow[] {
  const jobScopes = expandBlock(job.permissions);
  const topScopes = expandBlock(top);
  const rows: GrantRow[] = [];

  for (const scope of PERMISSION_SCOPES) {
    if (scope in jobScopes) {
      rows.push({ scope, level: jobScopes[scope], source: `job:${job.id}` });
      continue;
    }
    if (scope in topScopes) {
      rows.push({ scope, level: topScopes[scope], source: "top" });
    }
  }

  // A scope GitHub does not know is still mapped verbatim, so a typo is
  // visible in the table instead of silently dropped.
  const extras = new Set<string>([
    ...Object.keys(jobScopes),
    ...Object.keys(topScopes),
  ]);
  for (const scope of [...extras].sort()) {
    if (PERMISSION_SCOPES.includes(scope)) continue;
    const level = scope in jobScopes ? jobScopes[scope] : topScopes[scope];
    rows.push({
      scope,
      level,
      source: scope in jobScopes ? `job:${job.id}` : "top",
    });
  }

  return rows;
}

/**
 * Builds the grant table for a parsed workflow: the top block, every job's own
 * block, the EFFECTIVE rows (job overrides top per scope) and the `unset` flag
 * that says the workflow grants nothing explicitly at all.
 */
export function buildGrantTable(model: WorkflowModel): GrantTable {
  const jobs = model.jobs.map((job) => ({
    jobId: job.id,
    block: job.permissions,
  }));

  const effective: GrantRow[] = [];
  for (const job of model.jobs) {
    for (const row of effectiveJobGrants(job, model.topPermissions)) {
      effective.push(row);
    }
  }

  const unset =
    model.topPermissions === null &&
    model.jobs.every((job) => job.permissions === null);

  return {
    top: model.topPermissions,
    jobs,
    effective,
    unset,
  };
}
