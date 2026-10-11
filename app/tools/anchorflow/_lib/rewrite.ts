// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — offset-surgical rewrite: source + resolutions → pinned string.
//
// THE CRUX (PLAN §2.1): a whole-document `doc.toString()` normalizes flow
// spacing (`[main]` → `[ main ]`) and collapses pre-comment whitespace, so the
// output path NEVER re-emits the doc; instead we replace ONLY the
// `uses:` scalar bytes — `[start, valueEnd)` — and splice from right to left,
// which leaves comments, blank lines, flow spacing and trailing whitespace
// byte-for-byte intact. That is what AC-2 (no-op round-trip) and AC-3 (pin
// shape) lock in.
//
// The pin format is GitHub's / Dependabot's own: `owner/repo[/path]@<40-hex>`
// with a SINGLE space before a trailing ` # <original-ref>`.
//
// IDEMPOTENCY: a `sha40` (or `sha256`) node is never an edit, so re-running the
// tool on its own output is a ZERO-diff (SPEC §4 F4 · AC-9).
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassifiedUses, Resolution } from "./types";

/** One byte range in `source` and the text that replaces it. */
export interface RewriteEdit {
  start: number;
  /** Exclusive end offset — the offset AFTER a quoted scalar's closing quote. */
  valueEnd: number;
  text: string;
}

/** The pin a resolution supplies for one node. */
export interface PinSpec {
  sha: string;
  originalRef: string;
}

const SHA40_RE = /^[0-9a-f]{40}$/;

/**
 * Anything the rewrite accepts as "the resolutions to apply": the array shape
 * from the pipeline, or a `Map` keyed either by the node id (`build:0`) or by
 * `owner/repo@ref` — both are normalised to one lookup by node id.
 */
export type ResolutionInput =
  | readonly Resolution[]
  | ReadonlyMap<string, Resolution>
  | Iterable<Resolution>;

function resolutionList(
  input: ResolutionInput | null | undefined
): Resolution[] {
  if (!input) return [];
  if (input instanceof Map) return [...input.values()];
  if (Symbol.iterator in input) return [...(input as Iterable<Resolution>)];
  return [];
}

/** Normalises any accepted resolution input to a map keyed by node id. */
export function toResolutionMap(
  input: ResolutionInput | null | undefined
): Map<string, Resolution> {
  const map = new Map<string, Resolution>();
  if (!input) return map;
  if (input instanceof Map) {
    for (const [key, value] of input) {
      map.set(key, value);
      const id = value?.ref?.id;
      if (id && !map.has(id)) map.set(id, value);
    }
    return map;
  }
  for (const resolution of resolutionList(input)) {
    const id = resolution?.ref?.id;
    if (id) map.set(id, resolution);
  }
  return map;
}

/**
 * True when the bytes at the node's recorded range still hold the node's own
 * scalar. A resolution replayed against a DIFFERENT source (or against the
 * tool's already-pinned output) fails this check, so a stale resolution can
 * never splice a SHA into the wrong offset — which is what makes re-pinning
 * idempotent even when a caller replays an old resolution set (AC-9).
 */
export function offsetsStillHold(source: string, uses: ClassifiedUses): boolean {
  const slice = source.slice(uses.start, uses.valueEnd);
  if (slice === uses.raw) return true;
  return slice === `"${uses.raw}"` || slice === `'${uses.raw}'`;
}

/** Offset of the newline that ends the line holding `offset` (or EOF). */
function lineEndFrom(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline === -1 ? source.length : newline;
}

/**
 * Offset of the `#` that opens the trailing comment carried by `comment`, or
 * -1. Scanning from the left and matching the full comment text keeps an inner
 * `#` (`# v4 # extra`) from being mistaken for the opener.
 */
function commentHashIndex(tail: string, comment: string): number {
  for (let i = 0; i < tail.length; i += 1) {
    if (tail[i] !== "#") continue;
    if (tail.slice(i + 1).trim() === comment) return i;
  }
  return -1;
}

/** The rewritten scalar: `owner/repo[/subpath]@<sha>`, always an unquoted plain scalar. */
export function pinScalar(uses: ClassifiedUses, sha: string): string {
  const segments = [uses.owner, uses.repo, uses.subpath].filter(
    (part): part is string => Boolean(part)
  );
  return `${segments.join("/")}@${sha}`;
}

/**
 * Builds the single edit that pins one node.
 *
 * Comment rules (PLAN decision 7 — CLOSED, no data is ever destroyed):
 *   · a trailing comment whose trimmed text EXACTLY equals the original ref is
 *     REPLACED in place, reusing the user's own leading whitespace;
 *   · any other trailing comment is preserved VERBATIM and ` # <ref>` is
 *     appended after it;
 *   · with no trailing comment the annotation is appended once, with a single
 *     space, immediately after the value (after the closing quote if quoted).
 */
export function applyPin(
  source: string,
  uses: ClassifiedUses,
  pin: PinSpec
): RewriteEdit {
  const { sha, originalRef } = pin;
  const lineEnd = lineEndFrom(source, uses.valueEnd);
  const tail = source.slice(uses.valueEnd, lineEnd);
  const pinned = pinScalar(uses, sha);

  const comment = uses.existingComment;
  if (comment) {
    const hashIndex = commentHashIndex(tail, comment);
    if (hashIndex !== -1) {
      if (comment === originalRef) {
        // Replace the ref comment in place — no doubling.
        return {
          start: uses.start,
          valueEnd: lineEnd,
          text: `${pinned}${tail.slice(0, hashIndex)}# ${originalRef}`,
        };
      }
      // Preserve the user's comment verbatim, then label the pin.
      return {
        start: uses.start,
        valueEnd: lineEnd,
        text: `${pinned}${tail} # ${originalRef}`,
      };
    }
  }

  // No trailing comment (or one the parser could not place): append once,
  // keeping any non-comment remainder (e.g. a flow-context `}`) in place.
  const remainder = tail.replace(/\s+$/, "");
  return {
    start: uses.start,
    valueEnd: lineEnd,
    text: `${pinned}${remainder} # ${originalRef}`,
  };
}

/** A resolution that has cleared every gate the rewrite applies. */
export interface PinnableResolution extends Resolution {
  status: "resolved";
  resolvedSha: string;
}

/** True when a resolution may become an edit at all. */
export function isPinnable(
  resolution: Resolution
): resolution is PinnableResolution {
  if (resolution.status !== "resolved") return false;
  if (typeof resolution.resolvedSha !== "string") return false;
  if (!SHA40_RE.test(resolution.resolvedSha)) return false;
  const uses = resolution.ref;
  if (!uses || uses.cls !== "remoteRef") return false;
  return Boolean(uses.ref);
}

/**
 * The edits for a resolution set. Only `resolved` `remoteRef` nodes are
 * pinnable — a `sha40`/`sha256` node is never an edit, so re-pinning the tool's
 * own output produces no edits at all.
 */
export function buildRewriteEdits(
  source: string,
  resolutions: ResolutionInput | null | undefined,
  classify?: readonly ClassifiedUses[]
): RewriteEdit[] {
  const byId = new Map<string, ClassifiedUses>(
    (classify ?? []).map((uses) => [uses.id, uses])
  );
  const edits: RewriteEdit[] = [];
  for (const resolution of toResolutionMap(resolutions).values()) {
    if (!isPinnable(resolution)) continue;
    const uses = byId.get(resolution.ref.id) ?? resolution.ref;
    if (!offsetsStillHold(source, uses)) continue;
    edits.push(
      applyPin(source, uses, {
        sha: resolution.resolvedSha,
        originalRef: uses.ref ?? resolution.ref.ref ?? "",
      })
    );
  }
  // Deterministic order; `applyEdits` re-sorts right-to-left anyway.
  return edits.sort((a, b) => a.start - b.start);
}

/**
 * Applies edits right-to-left so every untouched byte survives exactly. Overlapping
 * edits are dropped rather than corrupting the output.
 */
export function applyEdits(source: string, edits: readonly RewriteEdit[]): string {
  const sorted = [...edits]
    .filter(
      (edit) =>
        edit.start >= 0 &&
        edit.valueEnd <= source.length &&
        edit.start <= edit.valueEnd &&
        edit.text !== source.slice(edit.start, edit.valueEnd)
    )
    .sort((a, b) => b.start - a.start || b.valueEnd - a.valueEnd);

  let out = source;
  let floor = source.length;
  for (const edit of sorted) {
    if (edit.valueEnd > floor) continue; // overlaps an already-applied edit
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.valueEnd);
    floor = edit.start;
  }
  return out;
}

/**
 * The pinned workflow. With no resolutions — or an empty map/array — the source
 * is returned BYTE-IDENTICAL, which is the AC-2 no-op round-trip guarantee.
 */
export function yamlRewrite(
  source: string,
  resolutions: ResolutionInput | null | undefined
): string {
  const map = toResolutionMap(resolutions);
  if (map.size === 0) return source;
  return applyEdits(source, buildRewriteEdits(source, map));
}
