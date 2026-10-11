// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — template-injection detection (ARCH §3.7 · SPEC §4 F6).
// Pure, no IO.
//
// GitHub expands `${{ … }}` BEFORE the shell, the action input, or the `if:`
// condition ever sees the text, so an attacker-controlled context that reaches
// an expression becomes code. This module tokenises the ENTIRE expression body
// — walking quotes, parens, dots, splats and index syntax — so an untrusted
// context is found wherever it hides:
//
//   echo ${{ github.event.issue.title }}                 (leading path)
//   echo $(format('{0}', github.event.issue.title))      (nested argument)
//   echo $(join(github.event.commits.*.message))         (splat argument)
//   echo "t-${{ github.head_ref }}"                       (concatenation)
//   if: github.event.issue.title == 'x'                   (bare expression)
//
// DEDUPE (adjudicated): one finding per SITE, at the maximum severity its
// tokens reach — an enumerated error context yields exactly one error, never an
// error and a warn for the same sink.
// ─────────────────────────────────────────────────────────────────────────────

import { evidenceText } from "./findings";
import type {
  Finding,
  InjectionSink,
  Severity,
  WorkflowModel,
} from "./types";

/** One enumerated untrusted context: the path, its grade and why it matters. */
export interface UntrustedContext {
  path: string;
  severity: Severity;
  note: string;
}

/**
 * The enumerated ERROR set (SPEC §4 F6). Every one of these is text an outside
 * contributor controls: a PR title or body, an issue comment, a review, a fork
 * ref, a commit message, a Pages build name.
 */
export const UNTRUSTED_CONTEXTS: ReadonlyArray<UntrustedContext> = [
  {
    path: "github.event.issue.title",
    severity: "error",
    note: "the issue title, which any reporter controls",
  },
  {
    path: "github.event.issue.body",
    severity: "error",
    note: "the issue body, which any reporter controls",
  },
  {
    path: "github.event.pull_request.title",
    severity: "error",
    note: "the pull request title, which any fork author controls",
  },
  {
    path: "github.event.pull_request.body",
    severity: "error",
    note: "the pull request body, which any fork author controls",
  },
  {
    path: "github.event.pull_request.head.ref",
    severity: "error",
    note: "the pull request's own branch name, which any fork author controls",
  },
  {
    path: "github.event.pull_request.head.label",
    severity: "error",
    note: "the pull request head label, which any fork author controls",
  },
  {
    path: "github.event.pull_request.head.repo.*",
    severity: "error",
    note: "the fork's repository coordinates, which any fork author controls",
  },
  {
    path: "github.event.comment.body",
    severity: "error",
    note: "an issue comment body, which any commenter controls",
  },
  {
    path: "github.event.review.body",
    severity: "error",
    note: "a pull request review body, which any reviewer controls",
  },
  {
    path: "github.event.review_comment.body",
    severity: "error",
    note: "a review-comment body, which any commenter controls",
  },
  {
    path: "github.event.discussion.title",
    severity: "error",
    note: "a discussion title, which any participant controls",
  },
  {
    path: "github.event.discussion.body",
    severity: "error",
    note: "a discussion body, which any participant controls",
  },
  {
    path: "github.event.head_commit.message",
    severity: "error",
    note: "the pushed commit message, which the pusher controls",
  },
  {
    path: "github.event.head_commit.author.*",
    severity: "error",
    note: "the pushed commit's author identity, which the pusher controls",
  },
  {
    path: "github.event.commits.*.message",
    severity: "error",
    note: "a pushed commit message, which the pusher controls",
  },
  {
    path: "github.event.workflow_run.head_branch",
    severity: "error",
    note: "the triggering run's branch, which the upstream pusher controls",
  },
  {
    path: "github.event.workflow_run.head_commit.message",
    severity: "error",
    note: "the triggering run's commit message, which the upstream pusher controls",
  },
  {
    path: "github.event.pages.*.page_name",
    severity: "error",
    note: "a Pages build's page name, which the build's author controls",
  },
  {
    path: "github.head_ref",
    severity: "error",
    note: "the pull request's branch name, which any fork author controls",
  },
];

/**
 * Contexts that are never attacker-controlled (SPEC §4 F6). A token starting
 * with one of these is skipped: the workflow's own metadata, its inputs, its
 * matrix, its secrets, and the outputs of earlier steps.
 */
export const SAFE_CONTEXT_PREFIXES: readonly string[] = [
  "github.sha",
  "github.ref",
  "github.ref_name",
  "github.repository",
  "github.repository_owner",
  "github.actor",
  "github.actor_id",
  "github.event_name",
  "github.run_id",
  "github.run_number",
  "github.run_attempt",
  "github.job",
  "github.workflow",
  "github.workflow_ref",
  "github.server_url",
  "github.api_url",
  "github.graphql_url",
  "github.action",
  "github.action_path",
  "github.action_ref",
  "github.action_repository",
  "github.triggering_actor",
  "github.token",
  "env.",
  "runner.",
  "matrix.",
  "needs.",
  "steps.",
  "inputs.",
  "vars.",
  "secrets.",
];

/** The note for an unattributed `github.event.*` context. */
const RESIDUAL_NOTE =
  "an unexplored `github.event.*` context — treated as untrusted until proven otherwise";

// ── Tokenizer ────────────────────────────────────────────────────────────────

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

/** Skips a quoted string literal, returning the index past its closing quote. */
function skipStringLiteral(text: string, open: number): number {
  const quote = text[open];
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Extracts a bracket index as path segments: `['title']` / `[0]`. A string key
 * becomes a real segment; a numeric index becomes a `*` hop, which is what a
 * splat pattern expects.
 */
function bracketSegments(text: string, open: number): { segments: string[]; end: number } | null {
  const close = text.indexOf("]", open);
  if (close === -1) return null;
  const inner = text.slice(open + 1, close).trim();
  if (!inner) return null;
  const stringKey = /^'([^']*)'$/.exec(inner) ?? /^"([^"]*)"$/.exec(inner);
  if (stringKey) {
    const key = stringKey[1].trim();
    return key ? { segments: [key], end: close + 1 } : null;
  }
  if (/^\d+$/.test(inner)) return { segments: ["*"], end: close + 1 };
  return null;
}

/**
 * Whole-expression tokenisation: every context path in the text, wherever it
 * sits — a leading context, a nested function argument, a splat, a concatenated
 * or indexed member. Non-context text (operators, literals, function names) is
 * dropped; parens and brackets are walked, never treated as terminators.
 */
export function tokenizeExpression(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'" || ch === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }

    if (!isIdentifierStart(ch)) {
      i += 1;
      continue;
    }

    let token = "";
    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (isIdentifierPart(c)) {
        token += c;
        j += 1;
        continue;
      }
      if (c === ".") {
        const next = text[j + 1];
        if (next === "*") {
          token += ".*";
          j += 2;
          continue;
        }
        if (next !== undefined && isIdentifierStart(next)) {
          token += ".";
          j += 1;
          continue;
        }
        break;
      }
      if (c === "[") {
        const bracket = bracketSegments(text, j);
        if (!bracket) break;
        for (const segment of bracket.segments) token += `.${segment}`;
        j = bracket.end;
        continue;
      }
      break;
    }

    if (token) tokens.push(token);
    i = j > i ? j : i + 1;
  }

  return tokens;
}

// ── Context matching ─────────────────────────────────────────────────────────

/** Splits a path on `.` — a `*` segment is its own element. */
function segments(path: string): string[] {
  return path.split(".").filter((part) => part.length > 0);
}

/** Segment-wise pattern match; `*` matches exactly one hop (or the tail). */
function matchesSegments(token: string[], pattern: string[]): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "*") {
      if (i === pattern.length - 1) return token.length > i;
      for (let k = i + 1; k <= token.length - (pattern.length - i - 1); k += 1) {
        if (matchesSegments(token.slice(k), pattern.slice(i + 1))) return true;
      }
      return false;
    }
    if (i >= token.length) return false;
    if (pattern[i] !== token[i]) return false;
  }
  return token.length === pattern.length;
}

/** The enumerated context a token matches, or null. */
export function matchUntrustedContext(token: string): UntrustedContext | null {
  const tokenSegments = segments(token);
  let best: UntrustedContext | null = null;
  for (const context of UNTRUSTED_CONTEXTS) {
    if (!matchesSegments(tokenSegments, segments(context.path))) continue;
    // Most-specific wins: the deeper pattern reports the site.
    if (!best || segments(context.path).length > segments(best.path).length) {
      best = context;
    }
  }
  return best;
}

/** True when the token names a context that is never attacker-controlled. */
export function isSafeContext(token: string): boolean {
  return SAFE_CONTEXT_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** True when the token is the residual `github.event.*` bucket. */
export function isResidualEventContext(token: string): boolean {
  return token === "github.event" || token.startsWith("github.event.");
}

/** One candidate at a sink: an enumerated error or a residual warn. */
interface Candidate {
  path: string;
  severity: Severity;
  note: string;
  enumerated: boolean;
}

/** Every untrusted candidate a token carries (at most one). */
function candidatesFor(token: string): Candidate[] {
  const enumerated = matchUntrustedContext(token);
  if (enumerated) {
    return [
      {
        path: enumerated.path,
        severity: enumerated.severity,
        note: enumerated.note,
        enumerated: true,
      },
    ];
  }
  if (isSafeContext(token)) return [];
  if (isResidualEventContext(token)) {
    return [
      { path: token, severity: "warn", note: RESIDUAL_NOTE, enumerated: false },
    ];
  }
  return [];
}

// ── Expression scanning ──────────────────────────────────────────────────────

/** Every `${{ … }}` region in the text, with its body. */
export function findExpressions(text: string): Array<{ body: string; start: number }> {
  const out: Array<{ body: string; start: number }> = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("${{", i);
    if (open === -1) break;
    const close = text.indexOf("}}", open + 3);
    if (close === -1) break;
    out.push({ body: text.slice(open + 3, close), start: open });
    i = close + 2;
  }
  return out;
}

/** The raw expressions a site carries: `if:` is bare, run/with are wrapped. */
function siteExpressions(
  text: string,
  source: "run" | "with" | "if"
): string[] {
  if (source === "if") return [text];
  return findExpressions(text).map((region) => region.body);
}

// ── Sites ────────────────────────────────────────────────────────────────────

interface Site {
  jobId: string;
  stepIndex: number | null;
  source: "run" | "with" | "if";
  /** `run` · `if` · `with.<input>` */
  label: string;
  text: string;
  start: number | null;
}

/** Every scannable site in the model, in the model's own order. */
function collectSites(model: WorkflowModel): Site[] {
  const sites: Site[] = [];

  for (const job of model.jobs) {
    for (const step of job.steps) {
      if (step.run !== null) {
        sites.push({
          jobId: job.id,
          stepIndex: step.index,
          source: "run",
          label: "run",
          text: step.run,
          start: step.runStart,
        });
      }
      for (const [key, value] of Object.entries(step.withValues)) {
        sites.push({
          jobId: job.id,
          stepIndex: step.index,
          source: "with",
          label: `with.${key}`,
          text: value,
          start: step.withStarts[key] ?? null,
        });
      }
      if (step.ifExpr !== null) {
        sites.push({
          jobId: job.id,
          stepIndex: step.index,
          source: "if",
          label: "if",
          text: step.ifExpr,
          start: step.ifStart,
        });
      }
    }

    // Reusable-workflow inputs are injection surfaces exactly like a step's.
    for (const [key, value] of Object.entries(job.withInputs)) {
      sites.push({
        jobId: job.id,
        stepIndex: null,
        source: "with",
        label: `with.${key}`,
        text: value,
        start: job.withInputStarts[key] ?? null,
      });
    }
  }

  return sites;
}

/** The remediation for a sink, by where the sink lives. */
function remediationFor(source: Site["source"]): string {
  if (source === "if") {
    return "Move the value into `env:` and gate on it with `if: env.FOO == '…'` — a bare condition cannot interpolate an untrusted expression safely.";
  }
  if (source === "with") {
    return "Move the value into `env:` and let the action read the environment variable — GitHub expands `${{ }}` before the action runs, so an untrusted value must never be interpolated into an input.";
  }
  return "Move the value into `env:` and reference \${VAR} in the script — GitHub expands `${{ }}` before the shell runs, so the value must never be interpolated into the command line.";
}

function titleFor(source: Site["source"]): string {
  if (source === "if") return "Template injection in an `if:` condition";
  if (source === "with") return "Template injection in a `with:` input";
  return "Template injection in a `run:` script";
}

/** The `where` path of a site. */
function whereFor(site: Site): string {
  return site.stepIndex === null
    ? `jobs.${site.jobId}.${site.label}`
    : `jobs.${site.jobId}.steps[${site.stepIndex}].${site.label}`;
}

/** The most specific candidate first; residuals keep their scan order. */
function orderedCandidates(candidates: readonly Candidate[]): Candidate[] {
  const errors = candidates
    .filter((candidate) => candidate.enumerated)
    .sort((a, b) => segments(b.path).length - segments(a.path).length);
  const warns = candidates.filter((candidate) => !candidate.enumerated);
  return [...errors, ...warns];
}

/** Evaluates one site: its candidates, or null when the site is clean. */
function scanSite(site: Site): { candidates: Candidate[]; expression: string } | null {
  const expressions = siteExpressions(site.text, site.source);
  if (expressions.length === 0) return null;

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let expression = "";

  for (const body of expressions) {
    if (!expression) expression = body.trim();
    for (const token of tokenizeExpression(body)) {
      for (const candidate of candidatesFor(token)) {
        if (seen.has(candidate.path)) continue;
        seen.add(candidate.path);
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return null;
  return { candidates, expression };
}

/** The finding copy for one sink, naming every context it carries. */
function detailFor(
  site: Site,
  ordered: readonly Candidate[],
  expression: string,
  where: string
): string {
  const worst = ordered[0];
  const expands =
    site.source === "if"
      ? "the condition is evaluated"
      : site.source === "with"
        ? "the action reads its input"
        : "the shell runs";
  const becomes =
    site.source === "if" ? "part of the condition" : "code or arguments";
  const others = ordered.length - 1;
  const tail =
    others > 0
      ? ` ${others} further untrusted context${others === 1 ? "" : "s"} at this site: ${ordered
          .slice(1)
          .map((candidate) => candidate.path)
          .join(", ")}.`
      : "";

  // An `if:` site holds a BARE expression — it never wore a `${{ }}` wrapper,
  // so the copy must not pretend it did.
  const wrapped =
    site.source === "if" ? `\`${expression}\`` : `\`\${{ ${expression} }}\``;

  return `The expression ${wrapped} interpolates \`${worst.path}\` (${worst.note}) into ${where}. GitHub expands \`\${{ }}\` before ${expands}, so the attacker-controlled value becomes ${becomes}.${tail}`;
}

/** Every injection sink in the model (ARCH §3.7's detector output). */
export function injectionDetect(model: WorkflowModel): InjectionSink[] {
  const sinks: InjectionSink[] = [];
  const counters = new Map<string, number>();

  for (const site of collectSites(model)) {
    const found = scanSite(site);
    if (!found) continue;

    const ordered = orderedCandidates(found.candidates);
    const worst = ordered[0];
    const siteKey = `${site.jobId}:${site.stepIndex ?? "job"}`;
    const n = (counters.get(siteKey) ?? 0) + 1;
    counters.set(siteKey, n);

    const where = whereFor(site);
    const displayExpression = evidenceText(
      site.source === "if" ? site.text : `\${{ ${found.expression} }}`
    );

    sinks.push({
      id: `template-injection:${siteKey}:${n}`,
      where,
      expression: displayExpression,
      detail: detailFor(site, ordered, found.expression, where),
      contextPath: worst.path,
      contextPaths: ordered.map((candidate) => candidate.path),
      severity: worst.severity,
      remediation: remediationFor(site.source),
      source: site.source,
      stepIndex: site.stepIndex,
      start: site.start,
    });
  }

  return sinks;
}

/**
 * The sinks as findings — the ONE canonical array carries injection as
 * `template-injection` findings (there is no parallel, silently-droppable
 * sinks channel: ARCH §3.1).
 */
export function injectionFindings(model: WorkflowModel): Finding[] {
  return injectionDetect(model).map((sink) => ({
    id: sink.id,
    category: "template-injection",
    severity: sink.severity,
    title: titleFor(sink.source),
    detail: sink.detail,
    remediation: sink.remediation,
    where: sink.where,
    evidence: sink.expression,
    start: sink.start,
  }));
}
