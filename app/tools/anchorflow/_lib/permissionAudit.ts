// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the GITHUB_TOKEN permission audit (ARCH §3.5 · SPEC §4 F5).
// Pure, no IO.
//
// The five canonical misconfigurations of a token grant, each carrying the
// grant semantics in its detail so the reader sees what the scope really does:
//
//   1. top-level `write-all`                       — error
//   2. job-level `write-all`                        — error
//   3. permissions UNSET while the job uses the token — info
//   4. over-broad write on a job that only reads     — warn
//   5. `id-token: write` with no OIDC consumer       — minor
//   6. `packages` / `pages` / `deployments` write with no matching purpose — minor
//   7. a read-only job scoped broader than `contents: read` — minor
//
// Rules 6 and 7 are the same audit expressed for the narrower scope families;
// rule 4 is the general "write it never needed" case. A job whose steps write
// through an unbounded channel (`github-script`, the `gh` CLI, a raw API call)
// proves nothing about its scope needs, so no scope claim is made about it
// (SPEC §9 AC-6 demands no false positive).
// ─────────────────────────────────────────────────────────────────────────────

import {
  jobProfile,
  needsWriteScope,
  type JobProfile,
} from "./actionCatalog";
import {
  PERMISSION_SCOPES,
  effectiveJobGrants,
  parsePermissions,
  scopeSemantics,
} from "./grantTable";
import type { Finding, JobNode, WorkflowModel } from "./types";

// ARCH §3.5 publishes `parsePermissions` on this module's surface.
export { parsePermissions };

/** Scopes with their own dedicated misconfiguration finding. */
const ID_TOKEN = "id-token";
const PURPOSE_SCOPES: ReadonlySet<string> = new Set([
  "packages",
  "pages",
  "deployments",
]);

/** The write scopes whose coupling to an elevated job is itself a finding. */
export const TOKEN_COUPLING_SCOPES: readonly string[] = [
  "contents",
  "packages",
  "pull-requests",
  "id-token",
];

/** Per-(job, site) counter so every finding id stays unique and deterministic. */
function findingId(
  category: Finding["category"],
  jobId: string,
  site: string,
  n: number
): string {
  return `${category}:${jobId}:${site}:${n}`;
}

/** The offset a job-level finding cites: its block, else its first step. */
export function jobAnchor(job: JobNode): number | null {
  if (job.permissionsStart !== null) return job.permissionsStart;
  for (const step of job.steps) {
    if (step.usesStart !== null) return step.usesStart;
    if (step.runStart !== null) return step.runStart;
    const withStart = Object.values(step.withStarts)[0];
    if (withStart !== undefined) return withStart;
    if (step.ifStart !== null) return step.ifStart;
  }
  return null;
}

/** "contents: write — push commits, tags and releases" for one scope. */
function grantLabel(scope: string, level: "read" | "write" | "none"): string {
  return `${scope}: ${level} (${scopeSemantics(scope)})`;
}

/** The remediation for narrowing one over-granted job scope. */
function narrowRemediation(source: string, jobId: string): string {
  if (source === "top") {
    return `Add a narrower block to this job — \`permissions: { contents: read }\` under \`jobs.${jobId}\` — or tighten the top-level grant.`;
  }
  return `Change this job's block to \`permissions: { contents: read }\`.`;
}

/** Every write scope a block's `write-all` shorthand would cover. */
function writeAllScopeList(): string {
  return PERMISSION_SCOPES.map((scope) => grantLabel(scope, "write")).join("; ");
}

export function permissionAudit(model: WorkflowModel): Finding[] {
  const findings: Finding[] = [];
  const top = model.topPermissions;

  // ── Classes 1 & 2 — the unconditional `write-all` grants ────────────────────
  if (top?.all === "write") {
    findings.push({
      id: findingId("excessive-permissions", "top", "job", 1),
      category: "excessive-permissions",
      severity: "error",
      title: "Workflow-level `permissions: write-all`",
      detail: `The top-level block hands \`GITHUB_TOKEN\` write on every scope — ${writeAllScopeList()}. Every job in this workflow inherits that grant, so a single injection sink anywhere becomes a write to the repository, its packages and its OIDC identity.`,
      remediation:
        "Pin the top-level grant to what the workflow actually needs (`permissions: { contents: read }`) and widen individual jobs only where required.",
      where: "permissions",
      evidence: "write-all",
      start: model.topPermissionsStart,
    });
  }

  for (const job of model.jobs) {
    if (job.permissions?.all !== "write") continue;
    findings.push({
      id: findingId("excessive-permissions", job.id, "job", 1),
      category: "excessive-permissions",
      severity: "error",
      title: "Job-level `permissions: write-all`",
      detail: `\`jobs.${job.id}\` hands \`GITHUB_TOKEN\` write on every scope — ${writeAllScopeList()}. Whatever that job does, the token can also push commits, upload packages and mint OIDC tokens.`,
      remediation: `Replace the job's block with the scopes it uses, e.g. \`permissions: { contents: read }\`.`,
      where: `jobs.${job.id}.permissions`,
      evidence: "write-all",
      start: job.permissionsStart ?? jobAnchor(job),
    });
  }

  // ── The per-job scan ────────────────────────────────────────────────────────
  for (const job of model.jobs) {
    const profile: JobProfile = jobProfile(job);
    let n = 1;

    // Class 3 — permissions UNSET while the job consumes the token.
    if (
      job.permissions === null &&
      top === null &&
      !profile.isReusableCall &&
      profile.consumesToken
    ) {
      findings.push({
        id: findingId("excessive-permissions", job.id, "job", n++),
        category: "excessive-permissions",
        severity: "info",
        title: "Permissions unset — the token inherits the repo default",
        detail: `There is no \`permissions:\` block at any level, and \`jobs.${job.id}\` consumes \`GITHUB_TOKEN\` (actions/checkout, the \`gh\` CLI, or an authenticated push). The token therefore takes the repository or organisation default, which is frequently \`write-all\`.`,
        remediation:
          "Pin it explicitly — `permissions: { contents: read }` on the job, or `read-all` at the top level and a narrower block per job.",
        where: `jobs.${job.id}.permissions`,
        evidence: "permissions: (unset)",
        start: jobAnchor(job),
      });
    }

    // A reusable-workflow call hides the callee's steps: nothing is proven.
    if (profile.isReusableCall) continue;

    const effective = effectiveJobGrants(job, top);
    const writeRows = effective.filter((row) => row.level === "write");
    const jobWritesSomething = profile.writeNeeds.size > 0;

    for (const row of writeRows) {
      // A write covered by a `write-all` block is already reported as such.
      if (coveredByWriteAll(row, job, top)) continue;
      // An unbounded write channel proves nothing about scope needs.
      if (profile.opaqueWriter) continue;
      // A proven need is not a misconfiguration.
      if (needsWriteScope(profile, row.scope)) continue;

      const source = row.source;

      if (row.scope === ID_TOKEN) {
        // A proven OIDC consumer is exactly what the scope is for.
        if (profile.needsOidc) continue;

        // Class 5 — id-token: write with no OIDC consumer.
        findings.push({
          id: findingId("excessive-permissions", job.id, "job", n++),
          category: "excessive-permissions",
          severity: "minor",
          title: "`id-token: write` with no OIDC consumer",
          detail: `\`jobs.${job.id}\` can mint an OIDC token (${scopeSemantics(
            ID_TOKEN
          )}), but no step consumes one — there is no \`aws-actions/configure-aws-credentials\`, \`azure/login\`, \`google-github-actions/auth\`, \`hashicorp/vault-action\` or \`$ACTIONS_ID_TOKEN_REQUEST_URL\` call here.`,
          remediation:
            "Remove `id-token: write` from this job's permissions, or add the cloud-login step that exchanges the token.",
          where: `jobs.${job.id}.permissions`,
          evidence: grantLabel(ID_TOKEN, "write"),
          start: job.permissionsStart ?? jobAnchor(job),
        });
        continue;
      }

      if (PURPOSE_SCOPES.has(row.scope) && !jobWritesSomething) {
        // Class 6 — packages / pages / deployments write with no matching purpose.
        findings.push({
          id: findingId("excessive-permissions", job.id, "job", n++),
          category: "excessive-permissions",
          severity: "minor",
          title: `\`${row.scope}: write\` with no matching purpose`,
          detail: `\`jobs.${job.id}\` holds ${grantLabel(
            row.scope,
            "write"
          )}, but nothing in the job ${purposeVerb(
            row.scope
          )}. ${source === "top" ? "The grant is inherited from the top-level block." : ""}`.trim(),
          remediation:
            source === "top"
              ? `Narrow this job's block — \`permissions: { ${row.scope}: read }\` — or drop the top-level grant.`
              : `Remove \`${row.scope}: write\` from this job's block.`,
          where: `jobs.${job.id}.permissions`,
          evidence: grantLabel(row.scope, "write"),
          start: job.permissionsStart ?? jobAnchor(job),
        });
        continue;
      }

      // Class 4 — an over-broad write on a job that only reads.
      findings.push({
        id: findingId("excessive-permissions", job.id, "job", n++),
        category: "excessive-permissions",
        severity: "warn",
        title: "Over-broad token grant",
        detail: `\`jobs.${job.id}\` holds ${grantLabel(
          row.scope,
          "write"
        )}${
          jobWritesSomething
            ? " while no step in this job needs it"
            : " while its steps only read — nothing here writes to that surface"
        }. An unused write grant is attack surface: any code injected into this job can use it.${
          source === "top" ? " The grant is inherited from the top-level block." : ""
        }`,
        remediation: narrowRemediation(source, job.id),
        where: `jobs.${job.id}.permissions`,
        evidence: grantLabel(row.scope, "write"),
        start: job.permissionsStart ?? jobAnchor(job),
      });
    }

    // Class 7 — a read-only job scoped broader than `contents: read`.
    if (writeRows.length === 0 && !profile.opaqueWriter) {
      const readScopes = effective
        .filter((row) => row.level === "read")
        .map((row) => row.scope);
      const minimal =
        readScopes.length === 1 && readScopes[0] === "contents";
      if (readScopes.length > 0 && !minimal) {
        findings.push({
          id: findingId("excessive-permissions", job.id, "job", n++),
          category: "excessive-permissions",
          severity: "minor",
          title: "Read grant broader than the least privilege",
          detail: `\`jobs.${job.id}\` only reads, but holds ${readScopes.length} read scopes — ${readScopes
            .map((scope) => grantLabel(scope, "read"))
            .join("; ")}. A read-only job needs \`contents: read\` and nothing else.`,
          remediation: `Narrow the job's block to \`permissions: { contents: read }\`.`,
          where: `jobs.${job.id}.permissions`,
          evidence: readScopes.map((scope) => grantLabel(scope, "read")).join("; "),
          start: job.permissionsStart ?? jobAnchor(job),
        });
      }
    }
  }

  return findings;
}

/** True when the write came from a `write-all` block (already reported). */
function coveredByWriteAll(
  row: { source: string },
  job: JobNode,
  top: WorkflowModel["topPermissions"]
): boolean {
  if (row.source === "top") return top?.all === "write";
  if (row.source === `job:${job.id}`) return job.permissions?.all === "write";
  return false;
}

/** What a job with no matching purpose for a scope fails to do. */
function purposeVerb(scope: string): string {
  switch (scope) {
    case "packages":
      return "publishes a package or container image (`docker/build-push-action`, `docker push`, `npm publish`)";
    case "pages":
      return "deploys GitHub Pages (`peaceiris/actions-gh-pages`, a `gh-pages` push)";
    case "deployments":
      return "creates a deployment (`chrnorm/deployment-action`, a `/deployments` API call)";
    default:
      return `performs the write ${scopeSemantics(scope)}`;
  }
}
