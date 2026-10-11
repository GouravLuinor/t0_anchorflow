import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyOne } from "../classify";
import { API_ORIGIN, resolveRefs } from "../refResolver";
import { DEFAULT_RATE_LIMIT, RATE_LIMIT_RESERVE } from "../constants";
import { LIVE_SET } from "./fixtures";

/**
 * The LIVE GOLDEN oracle (SPEC §9 AC-5 · ARCH §5).
 *
 * GATED behind `GH_LIVE=1`, and NEVER part of the default CI path: plain
 * `npm test` skips this file, so CI stays hermetic. When a human sets
 * `GH_LIVE=1` it re-fetches set T from `https://api.github.com`, compares
 * every SHAs against the RECORDED expectations in `fixtures/index.ts` (the
 * pinned oracle) and cross-checks each with `git ls-remote <url> <refspec>` —
 * the peeled form, so an annotated tag proves it dereferenced to the commit it
 * names.
 *
 * SKIP, never FAIL: on a CI runner (or any offline / blocked host) the probe
 * answers 403/429 or fails to connect, and AC-5 requires that runner to be
 * reported as skipped rather than failed.
 */
const LIVE = process.env.GH_LIVE === "1";

const nodes = LIVE_SET.map((entry, index) =>
  classifyOne(
    entry.subpath
      ? `${entry.owner}/${entry.repo}/${entry.subpath}@${entry.ref}`
      : `${entry.owner}/${entry.repo}@${entry.ref}`,
    {
      id: `live-${index}`,
      jobId: "live",
      scope: "step" as const,
      stepIndex: index,
      start: 0,
      valueEnd: 0,
      existingComment: null,
    }
  )
);

/** `git ls-remote` peel, or null when the refspec is absent (or git is absent). */
function lsRemote(owner: string, repo: string, refspec: string): string | null {
  let out: string;
  try {
    out = execFileSync("git", ["ls-remote", `https://github.com/${owner}/${repo}.git`, refspec], {
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
  if (!out) return null;
  const sha = out.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha ?? "") ? (sha as string) : null;
}

const describeLive = LIVE ? describe : describe.skip;

describeLive("resolveRefs — the live golden oracle (GH_LIVE=1)", () => {
  it("resolves set T to the recorded SHAs, and ls-remote agrees", async (context) => {
    // 1. Probe the host first: an offline or rate-limited host skips, never
    //    fails, and the probe SEEDS the budget from the server's own report.
    let budget = { ...DEFAULT_RATE_LIMIT };
    try {
      const probe = await fetch(`${API_ORIGIN}/rate_limit`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (probe.status === 403 || probe.status === 429) {
        context.skip();
        return;
      }
      if (probe.ok) {
        const core = (await probe.json())?.resources?.core ?? null;
        budget = {
          limit: Number(core?.limit ?? DEFAULT_RATE_LIMIT.limit),
          remaining: Number(core?.remaining ?? 0),
          resetAt: Number(core?.reset ?? 0) * 1000,
        };
      }
    } catch {
      context.skip();
      return;
    }
    if (budget.remaining <= RATE_LIMIT_RESERVE) {
      context.skip();
      return;
    }

    // 2. The real chain, seeded with the budget the server just reported.
    const run = await resolveRefs(nodes, {
      fetchImpl: fetch,
      budget,
      now: () => Date.now(),
    });

    // A runner the resolver could not read is a SKIP, not a failure (AC-5).
    const blocked = run.resolutions.filter(
      (resolution) =>
        resolution.status === "network-error" ||
        (resolution.status === "rate-limited" &&
          resolution.receipt?.note?.includes("hourly"))
    );
    expect(run.resolutions.length).toBe(LIVE_SET.length);
    if (blocked.length > 0) {
      context.skip();
      return;
    }

    for (const [index, entry] of LIVE_SET.entries()) {
      const label = `${entry.owner}/${entry.repo}@${entry.ref}`;
      const resolution = run.resolutions[index];
      if (entry.commitSha === null) {
        // The deliberately unknown ref must be unknown-ref for the resolver AND
        // absent for ls-remote — both sides must agree it does not exist.
        expect(resolution?.status, label).toBe("unknown-ref");
        expect(lsRemote(entry.owner, entry.repo, entry.refspec), label).toBeNull();
        continue;
      }
      expect(resolution?.status, label).toBe("resolved");
      expect(resolution?.commitSha, label).toBe(entry.commitSha);
      expect(lsRemote(entry.owner, entry.repo, entry.refspec), label).toBe(
        entry.commitSha
      );
    }
  });
});
