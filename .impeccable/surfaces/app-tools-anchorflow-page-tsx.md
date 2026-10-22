---
version: 1
slug: "app-tools-anchorflow-page-tsx"
primary_target: "app/tools/anchorflow/page.tsx"
related_targets: []
---

Scope: /tools/anchorflow, the whole page. Visitor mode: Operate for the first viewport and the pinning flow (paste → see what is unpinned and risky → resolve & pin → copy file or diff); Persuade/Read for the sections below (how it compares, guide, FAQ) and the /learn pages.
Audience & job: engineers who own a repo's CI and need a reviewable PR that pins actions and fixes token grants. Proof: the live certified copy of their own workflow, the per-pin receipts, the zero-egress default path.
Memorable moment: each pinned action wears a guilloché seal drawn from its own commit SHA; resolving draws the seals in, one per pinned line, and the same SHA always draws the same seal.
Unresolved: anchorflow.norai.tech DNS/nginx (owner). Sign-in has no gated feature yet; it stays a quiet offer.

## Direction contract
THESIS: The result is a certified copy of the visitor's workflow: every action either carries a seal drawn from its commit SHA or is visibly unsealed. Refuses the category default: a dark cockpit of equal panels with a metrics strip (chars/words/bytes) as the hero.
OWN-WORLD: Security-printing material. Light: pale security-paper green ground (#eef2ec), sheet #fbfcfa, intaglio ink #10231c, seal green #1f6b4f as primary/pinned, indigo #4b4fa8 for moving/unpinned, vermilion for critical, ochre for major. Dark: intaglio night ground (#0d1613) with the same roles brightened. Guilloché only on seals, the brand rosette and one header rule. Schibsted Grotesk for UI and prose; Martian Mono only for YAML, SHAs, line numbers and receipts. 2px radii, 1px rules, no shadows on panels.
STORY: Paste or keep the example. Read one sentence: how many actions are unpinned and what is risky. Press Resolve & pin (the request count is disclosed). Watch seals land on each pinned line; open a receipt. Copy the pinned file or the diff into a PR; fix the findings next.
FIRST VIEWPORT: Header with rosette mark + Anchorflow, nav (Pin a workflow · Compare · Guide · FAQ), theme, quiet Sign in, Nor AI link; guilloché rule under it. H1 "Pin GitHub Actions to commit SHAs, in your browser", one-line sub, three promises (never uploaded · no account · free). Work area 40/60: left "Your workflow" editor (Example, Clear, lines/bytes); right "Certified copy": verdict sentence with the next step, primary "Resolve & pin N refs" + network disclosure, then the uses ledger (seal or open seal, uses, status word, line). Tabs below: Findings · Token grants · Pinned file · Diff.
FORM: Certified Copy (notarial certificate / security printing), candidate 5 of 7 on my ordered list; seed key 1a509fb7. Signature: SHA-seeded guilloché seal per pin, drawn in on resolve (420ms stroke draw, off under reduced motion). Raises: full 40-hex SHAs in ledger and receipts (datamatics); severity by mark size on one fixed ramp plus a word (star atlas); Pinned / As pasted as two whole sides (j-card); one next step owns the verdict line (feed).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
