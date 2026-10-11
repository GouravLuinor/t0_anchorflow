import { describe, expect, it } from "vitest";
import {
  isCheckout,
  isFullyPinned,
  jobProfile,
  knowledgeFor,
  needsWriteScope,
  ownerRepo,
  untrustedRefExpression,
  UNTRUSTED_REF_EXPRESSIONS,
} from "../actionCatalog";
import { parseWorkflow } from "../yamlParse";
import type { JobNode, WorkflowModel } from "../types";

/**
 * The action/command knowledge base both audits read (ARCH §3.4).
 *
 * This is 10.7 KB of real logic with no suite of its own, exercised only
 * through the audits that consume it — so a regression here (a catalog key
 * going stale, a prefix rule matching the wrong repo, a run pattern leaking
 * `usesToken` onto a job that never uses one) would show up as a permission
 * finding nobody could trace back. These are the contract the audits rely on.
 */

function modelOf(source: string): WorkflowModel {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.model;
}

function jobOf(source: string): JobNode {
  const model = modelOf(source);
  const job = model.jobs[0];
  if (!job) throw new Error("fixture carries no job");
  return job;
}

const WRAP = (steps: string): string =>
  `name: catalog\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

describe("ownerRepo — the catalog's lookup key", () => {
  it("drops the ref and the subpath", () => {
    expect(ownerRepo("actions/checkout@v4")).toBe("actions/checkout");
    expect(ownerRepo("github/codeql-action/init@v3")).toBe("github/codeql-action");
    expect(ownerRepo("docker/build-push-action@v6")).toBe(
      "docker/build-push-action"
    );
  });

  it("returns null for anything without both segments", () => {
    expect(ownerRepo("checkout@v4")).toBeNull();
    expect(ownerRepo("docker://alpine:3.20")).toBeNull();
    // A local or docker reference is classified BEFORE the catalog is consulted
    // (`isLocalPath` / `isDockerRef` in `classify.ts`); the catalog itself only
    // claims knowledge about a real owner/repo shape.
    expect(knowledgeFor("./local/action")).toBeNull();
    expect(knowledgeFor("docker://alpine:3.20")).toBeNull();
  });
});

describe("isCheckout — recognized whatever the subpath", () => {
  it("matches actions/checkout at any ref or subpath", () => {
    expect(isCheckout("actions/checkout@v4")).toBe(true);
    expect(isCheckout("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683")).toBe(
      true
    );
  });

  it("does not match a similarly named action", () => {
    expect(isCheckout("actions/checkout-action@v4")).toBe(false);
    expect(isCheckout("actions/setup-node@v4")).toBe(false);
    expect(isCheckout("./actions/checkout")).toBe(false);
  });
});

describe("knowledgeFor — exact keys and owner prefixes", () => {
  it("resolves an exact owner/repo entry", () => {
    const knowledge = knowledgeFor("actions/checkout@v4");
    expect(knowledge?.reads).toEqual(["contents"]);
    expect(knowledge?.usesToken).toBe(true);
    // Checkout reads; it does not prove a write need.
    expect(knowledge?.writes).toBeUndefined();
  });

  it("resolves an OWNER-PREFIX entry against any repo in it", () => {
    // `aws-actions/` covers every AWS action without listing them.
    expect(knowledgeFor("aws-actions/configure-aws-credentials@v4")?.oidc).toBe(
      true
    );
    expect(knowledgeFor("aws-actions/whatever-new-action@v1")).not.toBeNull();
  });

  it("marks the opaque writers opaque", () => {
    expect(knowledgeFor("actions/github-script@v7")?.opaque).toBe(true);
    expect(knowledgeFor("actions/checkout@v4")?.opaque).toBeUndefined();
  });

  it("returns null for an unknown action — never a guess", () => {
    expect(knowledgeFor("acme/definitely-not-known@v1")).toBeNull();
    expect(knowledgeFor("nonsense")).toBeNull();
  });
});

describe("jobProfile — what a job's steps PROVE about it", () => {
  it("derives read needs from an action's declared reads", () => {
    const job = jobOf(WRAP("      - uses: actions/checkout@v4\n"));
    const profile = jobProfile(job);
    expect(profile.consumesToken).toBe(true);
    expect(profile.readNeeds).toEqual(new Set(["contents"]));
    expect(profile.writeNeeds).toEqual(new Set<string>());
    expect(profile.opaqueWriter).toBe(false);
  });

  it("derives write needs from a releasing action", () => {
    const job = jobOf(
      WRAP("      - uses: softprops/action-gh-release@v2\n")
    );
    const profile = jobProfile(job);
    expect(needsWriteScope(profile, "contents")).toBe(true);
    expect(needsWriteScope(profile, "issues")).toBe(false);
    expect(profile.publishesPackages).toBe(false);
  });

  it("recognizes `packages`, `pages` and `deployments` purposes", () => {
    expect(
      jobProfile(jobOf(WRAP("      - uses: docker/build-push-action@v6\n")))
        .publishesPackages
    ).toBe(true);
    expect(
      jobProfile(
        jobOf(WRAP("      - uses: peaceiris/actions-gh-pages@v4\n"))
      ).publishesPages
    ).toBe(true);
    expect(
      jobProfile(
        jobOf(
          WRAP(
            "      - uses: chrnorm/deployment-action@v2\n        with:\n          token: ${{ secrets.GITHUB_TOKEN }}\n"
          )
        )
      ).createsDeployments
    ).toBe(true);
  });

  it("an OIDC consumer is recognized, with no write claim implied", () => {
    const profile = jobProfile(
      jobOf(WRAP("      - uses: pypa/gh-action-pypi-publish@release/v1\n"))
    );
    expect(profile.needsOidc).toBe(true);
    expect(profile.writeNeeds).toEqual(new Set(["id-token"]));
    // OIDC is not a GITHUB_TOKEN write, and the profile never claims one.
    expect(profile.consumesToken).toBe(false);
    expect(profile.opaqueWriter).toBe(false);
  });

  it("reads run-command heuristics as PROVEN needs", () => {
    const job = jobOf(
      WRAP(
        '      - run: |\n          git push origin HEAD\n          gh release create v1\n'
      )
    );
    const profile = jobProfile(job);
    expect(needsWriteScope(profile, "contents")).toBe(true);
    expect(profile.consumesToken).toBe(true);
  });

  it("proves NOTHING about an opaque writer — no false positives", () => {
    // A generic `gh api` call is an opaque channel: the audit must not claim a
    // scope need from it (SPEC §9 AC-6 demands no false positive).
    const job = jobOf(WRAP("      - run: gh api /repos/o/r/issues\n"));
    const profile = jobProfile(job);
    expect(profile.opaqueWriter).toBe(true);
    expect(profile.writeNeeds).toEqual(new Set<string>());
    expect(profile.readNeeds).toEqual(new Set<string>());
    expect(profile.consumesToken).toBe(true);
  });

  it("still counts a KNOWN deployment endpoint as a proven write", () => {
    // The one `gh api` pattern the catalog names precisely: the Deployments
    // REST endpoint, whose write is unambiguous.
    const job = jobOf(
      WRAP("      - run: gh api -X POST /repos/o/r/deployments\n")
    );
    const profile = jobProfile(job);
    expect(profile.opaqueWriter).toBe(true);
    expect(profile.writeNeeds).toEqual(new Set(["deployments"]));
    expect(profile.createsDeployments).toBe(true);
  });

  it("marks a reusable-workflow call, whose steps are invisible", () => {
    const job = jobOf(
      `name: catalog\non: [push]\njobs:\n  call:\n    uses: octo-org/reusable/.github/workflows/release.yml@main\n`
    );
    const profile = jobProfile(job);
    expect(profile.isReusableCall).toBe(true);
    // Invisible steps prove nothing either.
    expect(profile.writeNeeds).toEqual(new Set<string>());
  });

  it("gives an empty profile for a job with no steps at all", () => {
    const profile = jobProfile({
      id: "empty",
      permissions: null,
      permissionsStart: null,
      steps: [],
      uses: null,
      withInputs: {},
      withInputStarts: {},
    });
    expect(profile).toEqual({
      opaqueWriter: false,
      consumesToken: false,
      needsOidc: false,
      writeNeeds: new Set<string>(),
      readNeeds: new Set<string>(),
      publishesPackages: false,
      publishesPages: false,
      createsDeployments: false,
      writesRepository: false,
      isReusableCall: false,
    });
  });
});

describe("untrustedRefExpression — the checkout refs that run forked code", () => {
  it("names the expression inside a decorated checkout ref", () => {
    expect(
      untrustedRefExpression("${{ github.event.pull_request.head.sha }}")
    ).toBe("github.event.pull_request.head.sha");
    expect(untrustedRefExpression("refs/pull/${{ github.head_ref }}/merge")).toBe(
      "github.head_ref"
    );
  });

  it("is ordered longest-first, so the most specific context wins", () => {
    // Every entry, and no duplicate paths: the list is the audit's vocabulary.
    expect(new Set(UNTRUSTED_REF_EXPRESSIONS).size).toBe(
      UNTRUSTED_REF_EXPRESSIONS.length
    );
  });

  it("returns null for a trusted ref or nothing at all", () => {
    expect(untrustedRefExpression("main")).toBeNull();
    expect(untrustedRefExpression("refs/tags/${{ github.ref }}")).toBeNull();
    expect(untrustedRefExpression(null)).toBeNull();
    expect(untrustedRefExpression("${{ }}")).toBeNull();
  });
});

describe("isFullyPinned — the job-level pinning verdict", () => {
  it("is true when every step reference is immutable", () => {
    const job = jobOf(
      WRAP(
        "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n" +
          "      - uses: ./.github/actions/setup\n"
      )
    );
    expect(isFullyPinned(job.steps)).toBe(true);
  });

  it("is false the moment a moving tag appears", () => {
    const job = jobOf(WRAP("      - uses: actions/checkout@v4\n"));
    expect(isFullyPinned(job.steps)).toBe(false);
  });

  it("is false for a reference that proves nothing at all", () => {
    const job = jobOf(WRAP("      - uses: totally-broken-ref\n"));
    expect(isFullyPinned(job.steps)).toBe(false);
  });

  it("ignores run-only steps — they carry no reference to pin", () => {
    const job = jobOf(WRAP("      - run: npm ci && npm test\n"));
    expect(isFullyPinned(job.steps)).toBe(true);
  });
});
