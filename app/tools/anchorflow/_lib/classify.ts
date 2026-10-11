// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — `uses:` classification (6 classes × 2 scopes). Pure, no IO.
//
// Every collected node lands in EXACTLY one class (SPEC §4 F2 · AC-1):
//   sha40    owner/repo[/path]@<40-hex>   — already pinned, never rewritten
//   sha256   owner/repo[/path]@<64-hex>   — unusual but pinned
//   remoteRef owner/repo[/path]@<ref>     — a tag/branch/HEAD needing resolution
//   local    ./path | ../path             — skipped
//   docker   docker://image[:tag]         — registry concern, out of v1 scope
//   invalid  empty / unparseable          — flagged, never rewritten
//
// The ref split is on the LAST `@` and keeps the subpath, so
// `owner/repo/path/to@ref` resolves the REPO once and rewrites
// `owner/repo/path/to@<sha>` (PLAN decision 1 — CLOSED).
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassifiedUses, UsesClass, UsesRaw } from "./types";

/** Branch aliases that always move (SPEC §4 F2 · PLAN decision 1). */
export const MOVING_REFS: readonly string[] = [
  "main",
  "master",
  "HEAD",
  "trunk",
  "develop",
  "latest",
];

/** A floating major: `@v4` / `@4` move; `@v4.2.0` / `@4.2` / `@1.2.3-rc.1` do not. */
export const FLOATING_MAJOR_RE = /^v?\d+$/;

/** A 40-hex commit SHA (all-caps hex is not a GitHub commit SHA). */
export const SHA40_RE = /^[0-9a-f]{40}$/;

/** A 64-hex digest — pinned, but not a commit we can resolve. */
export const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * The adjudicated moving-target rule, verbatim:
 * `moving = (ref matches ^v?\d+$) OR ref ∈ {main, master, HEAD, trunk, develop, latest}`
 */
export function isMovingRef(ref: string): boolean {
  if (MOVING_REFS.includes(ref)) return true;
  return FLOATING_MAJOR_RE.test(ref);
}

/** True when the value points at a local action path (`./` / `../`). */
export function isLocalPath(raw: string): boolean {
  return /^\.{1,2}\//.test(raw);
}

/** True when the value is a docker image reference. */
export function isDockerRef(raw: string): boolean {
  return raw.startsWith("docker://");
}

interface RefParts {
  ownerRepo: string;
  ref: string;
}

/** Splits on the LAST `@`; SHAs and GitHub paths never contain one. */
export function splitRemoteRef(raw: string): RefParts | null {
  const at = raw.lastIndexOf("@");
  if (at <= 0) return null;
  const ownerRepo = raw.slice(0, at);
  const ref = raw.slice(at + 1);
  if (!ownerRepo || !ref) return null;
  return { ownerRepo, ref };
}

/**
 * Classifies one raw `uses:` scalar. `meta` is the `UsesRaw` payload minus the
 * raw text, so a caller can classify a node it collected itself.
 */
export function classifyOne(
  raw: string,
  meta: Omit<UsesRaw, "raw">
): ClassifiedUses {
  const base: ClassifiedUses = {
    ...meta,
    raw,
    cls: "invalid",
    owner: null,
    repo: null,
    subpath: null,
    ref: null,
    moving: false,
  };

  const value = raw.trim();
  if (!value) return base;

  if (isLocalPath(value)) return { ...base, cls: "local" };
  if (isDockerRef(value)) return { ...base, cls: "docker" };

  const parts = splitRemoteRef(value);
  if (!parts) return base;

  const { ownerRepo, ref } = parts;
  const segments = ownerRepo.split("/");
  const [owner, repo, ...rest] = segments;
  // `owner/repo` is the minimum shape a remote action can have.
  if (!owner || !repo) return base;

  if (SHA40_RE.test(ref)) {
    return {
      ...base,
      cls: "sha40",
      owner,
      repo,
      subpath: rest.length > 0 ? rest.join("/") : null,
      ref,
      moving: false,
    };
  }
  if (SHA256_RE.test(ref)) {
    return {
      ...base,
      cls: "sha256",
      owner,
      repo,
      subpath: rest.length > 0 ? rest.join("/") : null,
      ref,
      moving: false,
    };
  }
  return {
    ...base,
    cls: "remoteRef",
    owner,
    repo,
    subpath: rest.length > 0 ? rest.join("/") : null,
    ref,
    moving: isMovingRef(ref),
  };
}

/** Classifies every collected node, preserving the model's order. */
export function classifyUses(raws: readonly UsesRaw[]): ClassifiedUses[] {
  return raws.map((uses) => {
    const { raw: _raw, ...meta } = uses;
    return classifyOne(uses.raw, meta);
  });
}

/** The classification summary the DiagnosticPane renders (pure, testable). */
export interface ClassSummary {
  total: number;
  /** Already immutable: sha40 + sha256. */
  pinned: number;
  /** remoteRef nodes — the resolvable set. */
  pending: number;
  /** Of those, the ones that move (`moving: true`). */
  moving: number;
  local: number;
  docker: number;
  invalid: number;
  /** local + docker — classified but never resolved or rewritten. */
  skipped: number;
  byClass: Record<UsesClass, number>;
}

/** Counts the classified nodes by class, keeping the display order stable. */
export function summarizeClasses(
  uses: readonly ClassifiedUses[]
): ClassSummary {
  const byClass: Record<UsesClass, number> = {
    sha40: 0,
    sha256: 0,
    remoteRef: 0,
    local: 0,
    docker: 0,
    invalid: 0,
  };
  for (const use of uses) byClass[use.cls] += 1;
  let moving = 0;
  for (const use of uses) if (use.moving) moving += 1;
  return {
    total: uses.length,
    pinned: byClass.sha40 + byClass.sha256,
    pending: byClass.remoteRef,
    moving,
    local: byClass.local,
    docker: byClass.docker,
    invalid: byClass.invalid,
    skipped: byClass.local + byClass.docker,
    byClass,
  };
}
