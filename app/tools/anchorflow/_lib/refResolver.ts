// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the read-only GitHub ref → commit-SHA resolver (ARCH §3.4).
//
// PURE. No IO of its own: the ONE network seam is `options.fetchImpl`, a
// REQUIRED option, so this module never names a global network call and the
// worker / main-thread fallback each supply `fetch` at their own boundary
// (AC-12 · AC-16 · `_lib/__tests__/purity.test.ts`).
//
// The ONLY origin addressed is `https://api.github.com`, and every URL carries
// nothing but `owner/repo[/subpath]` + the ref token — no query, no fragment,
// no repo search (AC-12). Reads are unauthenticated and sit on the visitor's
// own browser IP, so the optimistic budget ledger plus the reserve floor keeps
// a workflow full of refs from spending the whole hour.
//
// The chain for one `uses:` (ARCH §4 F3 · verified endpoint shapes):
//   GET /repos/{o}/{r}/git/ref/tags/{ref}  → {object:{sha,type}}
//     type === "commit" → lightweight: that sha IS the commit
//     type === "tag"    → annotated: that sha is the TAG OBJECT, so deref
//   GET /repos/{o}/{r}/git/tags/{sha}       → {object:{sha}} = the commit
//   GET /repos/{o}/{r}/git/ref/heads/{ref}  → branch fallback when tags 404s
//
// Outcomes are VALUES, never throws: `resolved` · `unknown-ref` (both hops
// 404) · `rate-limited` (403/429, the reserve floor, the per-run cap or the
// wall-clock budget) · `network-error` (fetch throw / unexpected shape).
// Every ref either resolves to a commit or carries an explicit status — never
// a silent drop (SPEC §7).
// ─────────────────────────────────────────────────────────────────────────────

import { SHA40_RE } from "./classify";
import {
  MAX_RESOLVE_CONCURRENCY,
  MAX_RESOLVES_PER_RUN,
  RATE_LIMIT_RESERVE,
  RESOLVE_BUDGET_MS,
  RESOLVE_CACHE_CAPACITY,
  RESOLVE_NEGATIVE_TTL_MS,
  RESOLVE_TIMEOUT_MS,
} from "./constants";
import type {
  ClassifiedUses,
  FetchLike,
  RateLimitState,
  Resolution,
  ResolveReceipt,
  ResolveStatus,
} from "./types";

/** The single origin this module ever addresses (SPEC §9 AC-12). */
export const API_ORIGIN = "https://api.github.com";

export interface ResolveOptions {
  /** The injected network seam. REQUIRED — there is no global default. */
  fetchImpl: FetchLike;
  /** Pool width; defaults to MAX_RESOLVE_CONCURRENCY. */
  concurrency?: number;
  /** The session budget. Copied, never mutated in place. */
  budget: RateLimitState;
  /** Stop fanning out when `remaining - inFlight <= floor`. */
  reserveFloor?: number;
  /** The caller's single in-flight Phase-B signal; aborts the whole fan-out. */
  signal?: AbortSignal;
  /** Total wall-clock budget for the fan-out (default RESOLVE_BUDGET_MS). */
  deadlineMs?: number;
  /** Success LRU: "owner/repo@ref" → commit sha (capacity RESOLVE_CACHE_CAPACITY). */
  cache?: Map<string, string>;
  /** Negative TTL store: "owner/repo@ref" → expiry epoch ms. */
  negativeCache?: Map<string, number>;
  /** Negative TTL duration (default RESOLVE_NEGATIVE_TTL_MS). */
  negativeTtlMs?: number;
  /** Injectable clock — receipt timestamps and the deadline both use it. */
  now?: () => number;
}

export interface ResolveRun {
  /** One entry per resolvable input node, in input order. */
  resolutions: Resolution[];
  /** The post-fan-out budget. */
  budget: RateLimitState;
}

/** One unique ref's outcome, shared by every node pointing at it. */
interface RefOutcome {
  status: ResolveStatus;
  commitSha: string | null;
  tagObjectSha: string | null;
  refKind: "tag" | "branch" | null;
  /** The API path of each hop ISSUED, in call order (AC-12 receipt trail). */
  endpoints: string[];
  /** The object sha each issued hop returned; null when it returned an error. */
  hopShas: (string | null)[];
  httpStatus: number | null;
  /** Why a hop was withheld or a call failed — surfaced in the receipt. */
  note: string | null;
  /** True when the outcome was served from a cache (zero quota spent). */
  cached: boolean;
}

/** The optimistic budget ledger. `inFlight` / `reserved` are local bookkeeping. */
interface Ledger extends RateLimitState {
  /** Calls dispatched but not yet settled. */
  inFlight: number;
  /** Units already deducted for a possible second call. */
  reserved: number;
  /** True once a response reported `x-ratelimit-remaining: 0` — the hour is
   *  spent OUT THERE, so a local reservation can never be released back. */
  hardZero: boolean;
}

interface Ctx {
  fetchImpl: FetchLike;
  ledger: Ledger;
  floor: number;
  signal: AbortSignal | undefined;
  deadlineMs: number;
  startedAt: number;
  now: () => number;
  cache: Map<string, string>;
  negativeCache: Map<string, number>;
  negativeTtlMs: number;
  /** Refs that have already consumed a dispatch slot this run. */
  dispatched: number;
}

type HeaderRead = (name: string) => string | null;

interface HttpOutcome {
  status: number;
  ok: boolean;
  body: unknown;
  headers: HeaderRead;
  /** A thrown error — the network-error case. */
  thrown: unknown;
}

// ── API paths and URLs ───────────────────────────────────────────────────────

/** Percent-encode one path segment, leaving the `/` a branch name keeps. */
function encodePathValue(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** The AC-12 path half for a ref lookup — the host is never part of it. */
export function refApiPath(
  kind: "tags" | "heads",
  owner: string,
  repo: string,
  ref: string
): string {
  return `/repos/${encodePathValue(owner)}/${encodePathValue(
    repo
  )}/git/ref/${kind}/${encodePathValue(ref)}`;
}

/** The AC-12 path half for the annotated-tag dereference. */
export function tagObjectApiPath(
  owner: string,
  repo: string,
  tagSha: string
): string {
  return `/repos/${encodePathValue(owner)}/${encodePathValue(
    repo
  )}/git/tags/${tagSha}`;
}

/** Absolute URL for one ref lookup. */
export function refUrl(
  kind: "tags" | "heads",
  owner: string,
  repo: string,
  ref: string
): string {
  return `${API_ORIGIN}${refApiPath(kind, owner, repo, ref)}`;
}

/** Absolute URL for the annotated-tag dereference. */
export function tagObjectUrl(
  owner: string,
  repo: string,
  tagSha: string
): string {
  return `${API_ORIGIN}${tagObjectApiPath(owner, repo, tagSha)}`;
}

/** The citation a receipt or finding quotes: `GET /repos/{o}/{r}/git/ref/...`. */
export function endpointLabel(apiPath: string): string {
  return `GET ${apiPath}`;
}

/** `owner/repo@ref` — the dedupe and cache key (the subpath is dropped). */
export function refCacheKey(uses: ClassifiedUses): string {
  return `${uses.owner}/${uses.repo}@${uses.ref}`;
}

/** True when a node can be resolved at all. */
export function isResolvable(uses: ClassifiedUses): boolean {
  return (
    uses.cls === "remoteRef" &&
    Boolean(uses.owner) &&
    Boolean(uses.repo) &&
    Boolean(uses.ref)
  );
}

function splitKey(key: string): [string, string, string] {
  const at = key.lastIndexOf("@");
  const ownerRepo = key.slice(0, at);
  const ref = key.slice(at + 1);
  const slash = ownerRepo.indexOf("/");
  return [ownerRepo.slice(0, slash), ownerRepo.slice(slash + 1), ref];
}

/** Branch-ish refs read as branch endpoints when a cached hit must be labelled. */
const BRANCH_LIKE = /^(refs\/heads\/)?(main|master|trunk|develop|HEAD|release\/.*)$/i;

// ── The optimistic budget ledger ─────────────────────────────────────────────

/** ARCH §3.4 dispatch gate: a ref runs only while the floor is untouched. */
export function canDispatch(
  ledger: Pick<Ledger, "remaining" | "inFlight">,
  floor: number
): boolean {
  return ledger.remaining - ledger.inFlight > floor;
}

/** One HTTP call went out: 1 optimistic unit + 1 in-flight slot. */
function beginCall(ledger: Ledger): void {
  ledger.remaining -= 1;
  ledger.inFlight += 1;
}

/** A call settled. */
function endCall(ledger: Ledger): void {
  if (ledger.inFlight > 0) ledger.inFlight -= 1;
}

/**
 * The second call of a chain (the annotated deref or the branch fallback) goes
 * out on the unit HELD at ref dispatch, so it costs the holdback and not
 * another decrement.
 */
function beginSecondCall(ledger: Ledger): void {
  ledger.inFlight += 1;
}

/** The holdback for this ref's possible second call (deref or branch fallback). */
function holdSecondUnit(ledger: Ledger): void {
  ledger.remaining -= 1;
  ledger.reserved += 1;
}

/** The second call never happened: hand the unused unit straight back. */
function releaseSecondUnit(ledger: Ledger): void {
  if (ledger.reserved <= 0) return;
  ledger.reserved -= 1;
  if (ledger.hardZero) return;
  ledger.remaining += 1;
}

/** The second call is now real; its unit was already deducted. */
function convertSecondUnit(ledger: Ledger): void {
  if (ledger.reserved > 0) ledger.reserved -= 1;
}

/** Adopt a server's quota report, but never let it inflate the ledger. */
function applyQuotaHeaders(ledger: Ledger, get: HeaderRead): void {
  const limit = headerInt(get("x-ratelimit-limit"));
  const remaining = headerInt(get("x-ratelimit-remaining"));
  const reset = headerInt(get("x-ratelimit-reset"));
  if (limit !== null && limit > 0) ledger.limit = limit;
  if (remaining !== null && remaining >= 0 && remaining < ledger.remaining) {
    ledger.remaining = remaining;
  }
  if (remaining === 0) {
    // The server is out of quota for the hour, so never release a local
    // reservation back into a ledger the server has already zeroed.
    ledger.remaining = 0;
    ledger.hardZero = true;
  }
  if (reset !== null && reset > 0) ledger.resetAt = reset * 1000;
}

/** `Retry-After` (delta-seconds or HTTP-date) is read BEFORE the hourly reset. */
function applyRetryAfter(ledger: Ledger, get: HeaderRead, nowMs: number): void {
  const raw = get("retry-after");
  if (raw === null) return;
  const seconds = Number(raw);
  let retryAt: number | null = null;
  if (Number.isFinite(seconds) && seconds >= 0) {
    retryAt = nowMs + seconds * 1000;
  } else {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) retryAt = date;
  }
  if (retryAt === null) return;
  if (ledger.resetAt === 0 || retryAt < ledger.resetAt) ledger.resetAt = retryAt;
}

function headerInt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

function isRateLimitedStatus(status: number): boolean {
  return status === 403 || status === 429;
}

function rateLimitNote(status: number, get: HeaderRead): string {
  const remaining = get("x-ratelimit-remaining");
  const reset = headerInt(get("x-ratelimit-reset"));
  if (remaining !== null && Number(remaining) === 0) {
    return reset !== null
      ? "the hourly API limit is spent (remaining 0)"
      : "the hourly API limit is spent";
  }
  if (status === 429) return "the API asked us to back off (429)";
  return "the API blocked this request with no rate headers (temporary block)";
}

// ── Per-request abort + timeout ──────────────────────────────────────────────

interface CallHandle {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * A per-call controller that aborts on the caller's signal OR at
 * RESOLVE_TIMEOUT_MS, so one hanging hop cannot consume the whole budget.
 */
function perRequestController(
  parent: AbortSignal | undefined,
  timeoutMs: number
): CallHandle {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

const NO_HEADERS: HeaderRead = () => null;

async function issueGet(
  ctx: Ctx,
  url: string,
  handle: CallHandle
): Promise<HttpOutcome> {
  try {
    const response = await ctx.fetchImpl(url, { signal: handle.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const headers: HeaderRead = (name) => {
      try {
        return response.headers?.get?.(name) ?? null;
      } catch {
        return null;
      }
    };
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      body,
      headers,
      thrown: null,
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      body: null,
      headers: NO_HEADERS,
      thrown: err,
    };
  }
}

/** `{object:{sha,type}}` → the object, or null when the shape is unexpected. */
function readObject(body: unknown): { sha: string; type: string } | null {
  if (!body || typeof body !== "object") return null;
  const object = (body as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const sha = (object as { sha?: unknown }).sha;
  const type = (object as { type?: unknown }).type;
  if (typeof sha !== "string" || !SHA40_RE.test(sha)) return null;
  return { sha, type: typeof type === "string" ? type : "" };
}

// ── Caches ───────────────────────────────────────────────────────────────────

function touchLru(cache: Map<string, string>, key: string): void {
  const value = cache.get(key);
  if (value === undefined) return;
  cache.delete(key);
  cache.set(key, value);
}

function storeSuccess(cache: Map<string, string>, key: string, sha: string): void {
  cache.delete(key);
  cache.set(key, sha);
  while (cache.size > RESOLVE_CACHE_CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ── The chain for one unique ref ─────────────────────────────────────────────

function stopped(
  status: ResolveStatus,
  note: string
): Omit<RefOutcome, "cached"> {
  return {
    status,
    commitSha: null,
    tagObjectSha: null,
    refKind: null,
    endpoints: [],
    hopShas: [],
    httpStatus: null,
    note,
  };
}

/**
 * Ends one ref: records a fresh success in the LRU. The held second unit is
 * released by the caller's `finally` exactly once, whether the chain needed
 * it or not — which is what makes "a lightweight ref releases its unused
 * unit" observable.
 */
function finish(
  ctx: Ctx,
  key: string,
  outcome: Omit<RefOutcome, "cached">
): RefOutcome {
  if (outcome.status === "resolved" && outcome.commitSha) {
    storeSuccess(ctx.cache, key, outcome.commitSha);
  }
  return { ...outcome, cached: false };
}

async function resolveUnique(ctx: Ctx, key: string): Promise<RefOutcome> {
  const [owner, repo, ref] = splitKey(key);
  const endpoints: string[] = [];
  const hopShas: (string | null)[] = [];

  // A cached success costs ZERO quota; the LRU is the very first gate.
  const cachedSha = ctx.cache.get(key);
  if (cachedSha !== undefined) {
    touchLru(ctx.cache, key);
    return {
      status: "resolved",
      commitSha: cachedSha,
      tagObjectSha: null,
      refKind: BRANCH_LIKE.test(ref) ? "branch" : "tag",
      endpoints,
      hopShas,
      httpStatus: null,
      note: "served from the in-session cache — zero API calls",
      cached: true,
    };
  }

  // A negatively-cached 404 costs ZERO quota for RESOLVE_NEGATIVE_TTL_MS.
  const negativeExpiry = ctx.negativeCache.get(key);
  if (negativeExpiry !== undefined) {
    if (ctx.now() < negativeExpiry) {
      return {
        status: "unknown-ref",
        commitSha: null,
        tagObjectSha: null,
        refKind: null,
        endpoints,
        hopShas,
        httpStatus: 404,
        note: "served from the negative cache — zero API calls",
        cached: true,
      };
    }
    ctx.negativeCache.delete(key);
  }

  // Run-level gates. Everything past this point spends quota.
  if (ctx.signal?.aborted) {
    return { ...stopped("not-requested", "resolve aborted before dispatch"), cached: false };
  }
  if (ctx.now() - ctx.startedAt > ctx.deadlineMs) {
    return { ...stopped("rate-limited", "the resolve budget elapsed"), cached: false };
  }
  if (ctx.dispatched >= MAX_RESOLVES_PER_RUN) {
    return {
      ...stopped(
        "rate-limited",
        `the per-run cap of ${MAX_RESOLVES_PER_RUN} resolutions was reached`
      ),
      cached: false,
    };
  }
  if (!canDispatch(ctx.ledger, ctx.floor)) {
    return { ...stopped("rate-limited", "the rate-limit reserve floor"), cached: false };
  }

  // 2 units: 1 for the chain GET, 1 reserved for the second call (the
  // annotated deref or the branch fallback). Released by the `finally` when
  // the chain never needed it.
  ctx.dispatched += 1;
  beginCall(ctx.ledger);
  holdSecondUnit(ctx.ledger);

  try {
    // ── hop 1 — the tag lookup ──────────────────────────────────────────────
    const tagsUrl = refUrl("tags", owner, repo, ref);
    const firstHandle = perRequestController(ctx.signal, RESOLVE_TIMEOUT_MS);
    let first: HttpOutcome;
    try {
      first = await issueGet(ctx, tagsUrl, firstHandle);
    } finally {
      firstHandle.dispose();
    }
    endpoints.push(refApiPath("tags", owner, repo, ref));
    hopShas.push(first.ok ? (readObject(first.body)?.sha ?? null) : null);
    applyQuotaHeaders(ctx.ledger, first.headers);
    applyRetryAfter(ctx.ledger, first.headers, ctx.now());
    endCall(ctx.ledger);

    if (first.ok) {
      const object = readObject(first.body);
      if (object === null) {
        return finish(
          ctx,
          key,
          {
            status: "network-error",
            commitSha: null,
            tagObjectSha: null,
            refKind: "tag",
            endpoints,
            hopShas,
            httpStatus: first.status,
            note: "the API returned a body the resolver could not read",
          }
        );
      }
      if (object.type === "commit") {
        // Lightweight tag: the returned sha IS the commit.
        return finish(ctx, key, {
          status: "resolved",
          commitSha: object.sha,
          tagObjectSha: null,
          refKind: "tag",
          endpoints,
          hopShas,
          httpStatus: first.status,
          note: null,
        });
      }
      if (object.type === "tag") {
        const tagSha = object.sha;
        if (!canDispatch(ctx.ledger, ctx.floor)) {
          return finish(ctx, key, {
            status: "rate-limited",
            commitSha: null,
            tagObjectSha: tagSha,
            refKind: "tag",
            endpoints,
            hopShas,
            httpStatus: first.status,
            note: "the annotated dereference was withheld at the reserve floor",
          });
        }
        convertSecondUnit(ctx.ledger);
        beginSecondCall(ctx.ledger);
        const derefUrl = tagObjectUrl(owner, repo, tagSha);
        const derefHandle = perRequestController(ctx.signal, RESOLVE_TIMEOUT_MS);
        let second: HttpOutcome;
        try {
          second = await issueGet(ctx, derefUrl, derefHandle);
        } finally {
          derefHandle.dispose();
        }
        endpoints.push(tagObjectApiPath(owner, repo, tagSha));
        hopShas.push(second.ok ? (readObject(second.body)?.sha ?? null) : null);
        applyQuotaHeaders(ctx.ledger, second.headers);
        applyRetryAfter(ctx.ledger, second.headers, ctx.now());
        endCall(ctx.ledger);

        const dereferenced = second.ok ? readObject(second.body) : null;
        if (dereferenced) {
          return finish(ctx, key, {
            status: "resolved",
            commitSha: dereferenced.sha,
            tagObjectSha: tagSha,
            refKind: "tag",
            endpoints,
            hopShas,
            httpStatus: second.status,
            note: null,
          });
        }
        if (second.status === 404) {
          return finish(ctx, key, {
            status: "unknown-ref",
            commitSha: null,
            tagObjectSha: tagSha,
            refKind: "tag",
            endpoints,
            hopShas,
            httpStatus: second.status,
            note: "the annotated tag object no longer exists",
          });
        }
        if (isRateLimitedStatus(second.status)) {
          return finish(ctx, key, {
            status: "rate-limited",
            commitSha: null,
            tagObjectSha: tagSha,
            refKind: "tag",
            endpoints,
            hopShas,
            httpStatus: second.status,
            note: rateLimitNote(second.status, second.headers),
          });
        }
        return finish(ctx, key, {
          status: "network-error",
          commitSha: null,
          tagObjectSha: tagSha,
          refKind: "tag",
          endpoints,
          hopShas,
          httpStatus: second.status,
          note: second.thrown
            ? "api.github.com could not be reached"
            : `the API answered ${second.status}`,
        });
      }
      return finish(ctx, key, {
        status: "network-error",
        commitSha: null,
        tagObjectSha: null,
        refKind: "tag",
        endpoints,
        hopShas,
        httpStatus: first.status,
        note: `the ref points at a ${object.type || "non-commit"} object`,
      });
    }

    if (first.status === 404) {
      // The tag does not exist — try the branch namespace.
      if (!canDispatch(ctx.ledger, ctx.floor)) {
        return finish(ctx, key, {
          status: "rate-limited",
          commitSha: null,
          tagObjectSha: null,
          refKind: "branch",
          endpoints,
          hopShas,
          httpStatus: first.status,
          note: "the branch fallback was withheld at the reserve floor",
        });
      }
      convertSecondUnit(ctx.ledger);
      beginSecondCall(ctx.ledger);
      const headsUrl = refUrl("heads", owner, repo, ref);
      const headsHandle = perRequestController(ctx.signal, RESOLVE_TIMEOUT_MS);
      let second: HttpOutcome;
      try {
        second = await issueGet(ctx, headsUrl, headsHandle);
      } finally {
        headsHandle.dispose();
      }
      endpoints.push(refApiPath("heads", owner, repo, ref));
      hopShas.push(second.ok ? (readObject(second.body)?.sha ?? null) : null);
      applyQuotaHeaders(ctx.ledger, second.headers);
      applyRetryAfter(ctx.ledger, second.headers, ctx.now());
      endCall(ctx.ledger);

      const object = second.ok ? readObject(second.body) : null;
      if (object) {
        return finish(ctx, key, {
          status: "resolved",
          commitSha: object.sha,
          tagObjectSha: null,
          refKind: "branch",
          endpoints,
          hopShas,
          httpStatus: second.status,
          note: null,
        });
      }
      if (second.status === 404) {
        // Both namespaces missed: cache the miss so a repeated typo costs
        // nothing for RESOLVE_NEGATIVE_TTL_MS.
        ctx.negativeCache.set(key, ctx.now() + ctx.negativeTtlMs);
        return finish(ctx, key, {
          status: "unknown-ref",
          commitSha: null,
          tagObjectSha: null,
          refKind: null,
          endpoints,
          hopShas,
          httpStatus: 404,
          note: "neither the tag nor the branch exists",
        });
      }
      if (isRateLimitedStatus(second.status)) {
        return finish(ctx, key, {
          status: "rate-limited",
          commitSha: null,
          tagObjectSha: null,
          refKind: "branch",
          endpoints,
          hopShas,
          httpStatus: second.status,
          note: rateLimitNote(second.status, second.headers),
        });
      }
      return finish(ctx, key, {
        status: "network-error",
        commitSha: null,
        tagObjectSha: null,
        refKind: "branch",
        endpoints,
        hopShas,
        httpStatus: second.status,
        note: second.thrown
          ? "api.github.com could not be reached"
          : `the API answered ${second.status}`,
      });
    }

    if (isRateLimitedStatus(first.status)) {
      return finish(ctx, key, {
        status: "rate-limited",
        commitSha: null,
        tagObjectSha: null,
        refKind: "tag",
        endpoints,
        hopShas,
        httpStatus: first.status,
        note: rateLimitNote(first.status, first.headers),
      });
    }

    return finish(ctx, key, {
      status: "network-error",
      commitSha: null,
      tagObjectSha: null,
      refKind: "tag",
      endpoints,
      hopShas,
      httpStatus: first.status,
      note: first.thrown
        ? "api.github.com could not be reached"
        : `the API answered ${first.status}`,
    });
  } finally {
    // Exactly one release, whichever way the chain went.
    releaseSecondUnit(ctx.ledger);
  }
}

// ── Receipts ─────────────────────────────────────────────────────────────────

/** The reproducible `git ls-remote` cross-check line for one ref (peeled). */
export function lsRemoteRefspec(uses: ClassifiedUses): string {
  return uses.ref ? `refs/tags/${uses.ref}^{}` : "refs/tags/^{}";
}

/**
 * The receipt for one node. An unresolved ref still gets one that names the
 * endpoint that stopped it — ARCH §8 demands the endpoint in the receipt,
 * never a silent drop.
 */
export function buildReceipt(
  uses: ClassifiedUses,
  outcome: RefOutcome,
  resolvedAt: string
): ResolveReceipt {
  const issued = outcome.endpoints;
  const paths =
    issued.length > 0
      ? issued
      : [refApiPath("tags", uses.owner ?? "", uses.repo ?? "", uses.ref ?? "")];
  const shas =
    issued.length > 0
      ? outcome.hopShas
      : [null];
  const labels = paths.map(endpointLabel);
  return {
    endpoint: labels[0],
    returnedSha: outcome.commitSha ?? "",
    dereferencedFrom: outcome.tagObjectSha ?? undefined,
    lsRemote: lsRemoteRefspec(uses),
    resolvedAt,
    note: outcome.note,
    chain: labels.map((label, index) => ({
      endpoint: label,
      sha: shas[index] ?? null,
      httpStatus: outcome.httpStatus ?? 0,
    })),
  };
}

// ── The fan-out ──────────────────────────────────────────────────────────────

/**
 * Resolves every `remoteRef` node. Nodes sharing `owner/repo@ref` (including
 * every subpath of the same repo) share ONE resolution, so a workflow that
 * calls `github/codeql-action/init@v3` three times still spends one chain.
 *
 * Never throws: an abort, an exhausted floor or a per-run cap all settle as
 * per-ref statuses, so the caller's full-envelope merge always completes.
 */
export async function resolveRefs(
  refs: readonly ClassifiedUses[],
  options: ResolveOptions
): Promise<ResolveRun> {
  const fetchImpl = options.fetchImpl;
  const concurrency = Math.max(
    1,
    options.concurrency ?? MAX_RESOLVE_CONCURRENCY
  );
  const floor = options.reserveFloor ?? RATE_LIMIT_RESERVE;
  const deadlineMs = options.deadlineMs ?? RESOLVE_BUDGET_MS;
  const now = options.now ?? (() => Date.now());
  const cache = options.cache ?? new Map<string, string>();
  const negativeCache = options.negativeCache ?? new Map<string, number>();
  const negativeTtlMs = options.negativeTtlMs ?? RESOLVE_NEGATIVE_TTL_MS;

  const ledger: Ledger = {
    ...options.budget,
    inFlight: 0,
    reserved: 0,
    hardZero: false,
  };
  const ctx: Ctx = {
    fetchImpl,
    ledger,
    floor,
    signal: options.signal,
    deadlineMs,
    startedAt: now(),
    now,
    cache,
    negativeCache,
    negativeTtlMs,
    dispatched: 0,
  };

  // Dedupe by `owner/repo@ref`; the node order is preserved for the answer.
  const queue: Array<{ key: string; nodes: ClassifiedUses[] }> = [];
  const byKey = new Map<string, { key: string; nodes: ClassifiedUses[] }>();
  for (const node of refs) {
    if (!isResolvable(node)) continue;
    const key = refCacheKey(node);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, nodes: [] };
      byKey.set(key, entry);
      queue.push(entry);
    }
    entry.nodes.push(node);
  }

  const outcomes = new Map<string, RefOutcome>();
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i += 1) {
    // A bounded worker pool: the parallel cap is the pool width, so draining
    // the queue serially inside each worker is the design, not a defect.
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const entry = queue[index];
          outcomes.set(entry.key, await resolveUnique(ctx, entry.key));
        }
      })()
    );
  }
  await Promise.all(workers);

  // Fan the shared outcome out to every node, in input order.
  const resolutions: Resolution[] = [];
  for (const node of refs) {
    if (!isResolvable(node)) continue;
    const key = refCacheKey(node);
    const outcome = outcomes.get(key) ?? {
      ...stopped("not-requested", "not resolved"),
      cached: false,
    };
    resolutions.push({
      ref: node,
      resolvedSha: outcome.commitSha,
      status: outcome.status,
      receipt: buildReceipt(node, outcome, new Date(now()).toISOString()),
      commitSha: outcome.commitSha,
      tagObjectSha: outcome.tagObjectSha,
      dereferencedFrom: outcome.tagObjectSha,
      refKind: outcome.refKind,
      httpStatus: outcome.httpStatus,
      endpointsUsed: [...outcome.endpoints],
    });
  }

  return {
    resolutions,
    budget: {
      limit: ledger.limit,
      remaining: Math.max(0, Math.min(ledger.remaining, ledger.limit)),
      resetAt: ledger.resetAt,
    },
  };
}
