# Benchmarks — Phase A, measured not estimated

All numbers below were produced by **`npm run bench`** (`scripts/bench-phase-a.ts`,
run with `tsx`). Nothing in this file was copied from a prior review or a
sibling tool: the command is shipped so anyone can re-run it on their own
machine and disagree with this table.

Measure the offline core — `analyzeLocal` in
`app/tools/anchorflow/_lib/analyze.ts` — because that is the whole first paint:
no worker spin-up, no React render, no network. The e2e suite then proves the
React/worker path on top of it.

## How to reproduce

```bash
npm install                 # tsx is a devDependency
npm run bench               # timings + the nested-flow memory probe
node --expose-gc --import tsx scripts/bench-phase-a.ts   # same, with explicit GC
```

The script prints, for each case: input size (lines + bytes), the
median / p95 / max wall-clock over `n = 50` runs (one warm-up run discarded), and
the margin against `WATCHDOG_MS`.

## Machine

| | |
|---|---|
| CPU | 13th Gen Intel Core i7-13620H (24 logical cores, 12 physical) |
| RAM | 6.9 GB total (~2.6 GB available during the run) |
| OS | linux x64 |
| Node | v24.13.0 (npm 11.8.0) |
| Date | 2026-10-11 |

The box was doing ordinary desktop work while timing, and free memory was
constrained, so the numbers are **conservative rather than best-case**. A quiet
builder machine lands lower.

## Timings

| Case | Input | median | p95 | max | Watchdog margin |
|---|---|---|---|---|---|
| 1,000-line workflow | 971 lines · 30,764 B | **11.4–15.9 ms** | 18.4–27.5 ms | 23.1–48.2 ms | **31–65×** |
| 5,000-line workflow | 4,815 lines · 153,579 B | **52.9–64.1 ms** | 57.8–101.3 ms | 58.7–118.8 ms | **12.6–25.6×** |
| Oversize, 3× the input cap | 23,499 lines · 786,914 B | **99.7–113.8 ms** | 111.7–188.0 ms | 117.5–241.8 ms | **6.2–12.8×** |

(Ranges over **ten consecutive runs** of the same command on the machine above;
quote the single-run p95. Every one of them is far inside the watchdog.)

### What the table proves

- **The oversize case exercises the cap honestly.** 786,914 B in → the analysis
  runs on the first 262,144 B, and the **original** byte count is still what the
  `bytes` metric reports (SPEC §9 AC-13) — the cap never makes a workflow look
  smaller than it is. The cut lands on a code-point boundary:
  `_lib/__tests__/analyze.test.ts` and `textMetrics.test.ts` assert no lone
  surrogate survives, and `truncateForDispatch` gates on `countBytes`, so a
  CJK-heavy paste is capped by bytes rather than by UTF-16 units.
- **The watchdog margin is 6×–65×, not 1.1×.** The worst p95 across ten runs is
  ~188 ms — still ~8× inside `WATCHDOG_MS` (1,500 ms) — and the worst *median* is
  ~114 ms. The terminate + respawn path therefore stays what it is designed for:
  a pathological parse on a slow mobile tab, never the normal case. The
  catastrophic journey in `e2e/pipeline.spec.ts` forces that path with a worker
  that never answers and asserts both the friendly verdict and a still-enabled
  editor.
- **Variance is real and is stated.** Run-to-run spread on this loaded box is
  roughly ±25 % on the small case and ±10 % on the large ones; the *ordering* of
  the cases is stable in every run, which is what the relative gate assertions
  depend on.

## Gate semantics (SPEC §9 AC-11)

- `WORKER_DEADLINE_MS` (1,000 ms) is a **measured / WARN threshold**, not a hard
  gate — the worker self-reports and the UI shows the friendly verdict.
- The default-path assertion is **relative**: the 5,000-line case completes in
  < 0.5 × `WORKER_DEADLINE_MS` and the 1,000-line case in < 0.25 ×, on whatever
  machine runs it.
- `WATCHDOG_MS` (1,500 ms) is the hard wall: terminate + respawn, never a hang.

## The nested-flow memory probe

`npm run bench` also spends the **same byte budget** two ways — one clean node
process per shape — and reports the heap each parse costs:

Five runs of the probe (one clean process per shape, each time):

| Shape | Input | Heap delta (5 runs) | RSS |
|---|---|---|---|
| flat workflow (steps on separate lines) | 255 KiB | **+18.8 / +19.1 / +19.4 / +19.6 / +21.3 MiB** | 111.3 / 115.6 / 129.8 MiB |
| deeply nested flow mappings | 248 KiB | **+45.1 / +45.2 / +45.3 / +46.7 / +51.6 MiB** | 168.9 / 171.2 / 175.8 MiB |

**Observation (the one thing this bench found worth writing down):** for an
almost identical byte count, the deeply nested flow mapping costs roughly **3×
the heap** of the flat shape. The eemeli parser builds a real node tree, and a
`{ a: { b: { c: … } } }` chain spends each byte on a new object plus its parent
link, whereas a flat `- uses:` step spends its bytes mostly on leaves.

That is not a defect — the input cap bounds how much of it can arrive — but it is
the shape a hostile or generated workflow reaches for first, so it is measured
and stated rather than assumed away. The watchdog is the backstop.

## Build & suite timings (same machine)

| Command | Result |
|---|---|
| `npm run build` | ~12 s, standalone output at `.next/standalone` |
| `npm run typecheck` | ~2 s, 0 errors |
| `npm run lint` | ~3 s, 0 problems |
| `npm test` (21 suites, 350 tests) | ~1.3 s |
| `npm run test:coverage` | ~2.5 s (thresholds green — see `QUALITY_REPORT.md`) |
| `npm run test:e2e` (42 passed, 2 skipped) | ~40 s (includes the standalone build the webServer boots) |
| First Load JS, `/tools/anchorflow` | **180 kB** (103 kB shared) |

## Bundle budget — how the happy path stays tiny

`context.md` §4.1 sets an initial-JS budget of ≤ 200 kB. `/tools/anchorflow`
ships **180 kB** First Load JS (103 kB of it the shared Next.js/React framework
chunks) — **20 kB under the budget**.

Nothing heavy is reachable from the first paint. Measured from
`.next/app-build-manifest.json` and enforced as a source graph walk by
`app/tools/anchorflow/__tests__/firstLoadBoundary.test.ts`:

| Slice | Where it lives | Reason |
|---|---|---|
| eemeli `yaml` + the audits + the resolver core | the **worker chunk**, loaded only by the worker | the compute runs off the main thread |
| the same core, for the degraded path | an **on-demand chunk** fetched by `degradeToMainThread` | degradation is rare, so it is never paid up front |

## Per-visitor quota reality

The resolver is **unauthenticated and browser-side**: every request goes from the
visitor's own browser IP to `api.github.com`, which is why the default path makes
**zero** requests (`autoResolve` is off, asserted in
`e2e/visual.spec.ts`). When a visitor does opt in, the budget that matters is
**theirs, not ours**:

- 60 requests per hour per IP — the unauthenticated GitHub rate limit;
- the tool holds a 2-request reserve floor and never spends a request it might
  need to label the answer;
- a workflow with more than `MAX_RESOLVES_PER_RUN` (48) refs resolves the first
  48 and marks the rest `rate-limited` rather than guessing.

So a real-world consequence is worth stating plainly: **two visitors behind the
same NAT share one 60/hr bucket**, and a visitor who has already used GitHub's
API that hour can see the rate-limit banner on a first resolve. The banner is
friendly copy with a countdown, the offline report stays complete, and nothing is
ever silently blanked.
