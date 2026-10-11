// Recorded GitHub REST responses — the PINNED ORACLE.
//
// Every file beside this one is a REAL capture of a request against
// `https://api.github.com`, and the object SHAS inside them are the
// expectations `refResolver.live.test.ts` must match byte-for-byte when a
// human runs it with `GH_LIVE=1`. The `x-ratelimit-*` values are the one
// normalized part: the hourly counter belongs to the recorder's own IP, so
// each capture is re-based onto a fresh 60/hr window as if it were the Nth
// call of a new hour.
//
// This module is the typed loader both consumers use:
//   · `refResolver.test.ts` / `analyzeResolve.test.ts` replay the captures
//     through an injected `fetchImpl` (hermetic, zero network);
//   · `e2e/resolve.spec.ts` serves the very same captures through
//     `page.route`, pinned to `localhost` so no request can escape.
// ONE source of truth, so a capture change can never drift between the two.
//
// To add a capture: drop the JSON beside this file. Nothing else moves.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface RecordedFixture {
  request: { method: string; path: string };
  response: RecordedResponse;
  /** The SHAs this capture pins, asserted by every consumer. */
  expects?: { tagObjectSha?: string; commitSha?: string };
}

// Resolved from the repository root, where BOTH consumers run (`vitest` and
// `playwright` are always launched from the project root). A relative path
// keeps this module importable from a CommonJS-transformed Playwright spec.
const HERE = "app/tools/anchorflow/_lib/__tests__/fixtures";

/**
 * Every `*.json` capture beside this file, keyed by the API path it answers.
 * A capture whose body carries no object is a 404 — included, because the
 * branch fallback and the miss-cache both depend on it.
 */
export const RECORDED: Record<string, RecordedFixture> = Object.fromEntries(
  readdirSync(HERE)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = JSON.parse(
        readFileSync(join(HERE, name), "utf8")
      ) as RecordedFixture;
      return [parsed.request.path, parsed] as const;
    })
);

/** A recorded response, ready to hand to an injected `fetchImpl`. */
export function recordedResponse(fixture: RecordedFixture): Response {
  return new Response(JSON.stringify(fixture.response.body), {
    status: fixture.response.status,
    headers: fixture.response.headers,
  });
}

/** The API path of a recorded capture, for syntactically stable assertions. */
export function recordedPath(path: string): string {
  return RECORDED[path]?.request.path ?? path;
}

/** The object sha a capture pins (the tag object, or the commit when plain). */
export function recordedSha(path: string): string | null {
  const object = RECORDED[path]?.response.body?.object;
  if (!object || typeof object !== "object") return null;
  const sha = (object as { sha?: unknown }).sha;
  return typeof sha === "string" ? sha : null;
}

/**
 * The recorded oracle set T (ARCH §5 / SPEC AC-5): one lightweight tag, one
 * annotated tag, one subpath action, one branch, one moving alias, one
 * floating major and one deliberately unknown ref. Every SHA here is a real,
 * re-fetchable observation.
 */
export interface LiveEntry {
  owner: string;
  repo: string;
  /** The subpath of the action being called, if any. */
  subpath: string | null;
  ref: string;
  /** The `git ls-remote` refspec that must name the same object. */
  refspec: string;
  /** null = the ref must not exist (a 404 for the resolver AND for ls-remote). */
  commitSha: string | null;
}

export const LIVE_SET: readonly LiveEntry[] = [
  {
    owner: "actions",
    repo: "checkout",
    subpath: null,
    ref: "v4",
    refspec: "refs/tags/v4",
    commitSha: "11d5960a326750d5838078e36cf38b85af677262",
  },
  {
    owner: "actions",
    repo: "checkout",
    subpath: null,
    ref: "v4.2.0",
    refspec: "refs/tags/v4.2.0",
    commitSha: "d632683dd7b4114ad314bca15554477dd762a938",
  },
  {
    owner: "pnpm",
    repo: "pnpm",
    subpath: null,
    ref: "v9.12.0",
    refspec: "refs/tags/v9.12.0^{}",
    commitSha: "fc7eed08c5d25b7e7349863bec0e43dca4247cd0",
  },
  {
    owner: "github",
    repo: "codeql-action",
    subpath: "init",
    ref: "v3",
    refspec: "refs/tags/v3^{}",
    commitSha: "9f759ee644a3e7c15c1390abf49868036c00067b",
  },
  {
    owner: "actions",
    repo: "checkout",
    subpath: null,
    ref: "main",
    refspec: "refs/heads/main",
    commitSha: "f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a",
  },
  {
    owner: "github",
    repo: "super-linter",
    subpath: null,
    ref: "latest",
    refspec: "refs/tags/latest",
    commitSha: "985ef206aaca4d560cb9ee2af2b42ba44adc1d55",
  },
  {
    owner: "actions",
    repo: "setup-node",
    subpath: null,
    ref: "v4",
    refspec: "refs/tags/v4",
    commitSha: "49933ea5288caeca8642d1e84afbd3f7d6820020",
  },
  {
    owner: "pnpm",
    repo: "pnpm",
    subpath: null,
    ref: "v9.12.0-does-not-exist",
    refspec: "refs/tags/v9.12.0-does-not-exist^{}",
    commitSha: null,
  },
];
