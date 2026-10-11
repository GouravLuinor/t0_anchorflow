# Anchorflow — BENCHMARKS.md

Reproducible measurements for the shipped compute core, regenerated per release
(not aspirational). Run the numbers yourself with the command below; the table
records what this repo measured on the machine noted.

## Reproduce

```bash
# Pure-core Phase A timing (the placeholder measurement path the worker runs).
npx tsx -e '
import { performance } from "node:perf_hooks";
import { analyzeLocal } from "./app/tools/anchorflow/_lib/analyze.ts";
const wf = Array.from({length: 250}, (_, j) =>
  ["  build-" + j + ":", "    runs-on: ubuntu-latest", "    steps:",
   ...Array.from({length: 4}, (_, s) =>
     ["      - uses: actions/checkout@v4", "        with:",
      "          ref: ${{ github.event.pull_request.head.sha }}",
      "      - run: echo \"step ' + s + '\" && npm ci && npm test"])].flat()
).join("\n");
const src = "name: bench\non:\n  push:\njobs:\n" + wf + "\n";
const runs = [];
for (let i = 0; i < 50; i++) { const t = performance.now(); analyzeLocal(src); runs.push(performance.now() - t); }
runs.sort((a,b)=>a-b);
console.log("lines:", src.split("\n").length-1, "bytes:", new TextEncoder().encode(src).length);
console.log("median", runs[25].toFixed(3)+"ms", "p95", runs[47].toFixed(3)+"ms");
'
```

## Measured — Phase A (`analyzeLocal`), n = 50 runs per case

| Case | Input | Median | p95 | Max | Budget |
|---|---|---|---|---|---|
| 1,000-line workflow | 960 lines / 33,374 B | **0.227 ms** | 0.531 ms | 1.011 ms | < 0.25 × `WORKER_DEADLINE_MS` (250 ms) |
| 5,000-line workflow | 4,760 lines / 166,724 B | **1.279 ms** | 1.686 ms | 1.820 ms | < 0.5 × `WORKER_DEADLINE_MS` (500 ms) |
| Oversize (3× cap) | 19,010 lines / 666,974 B | **7.734 ms** (analyzed at the 256 KiB cap) | 9.087 ms | 13.483 ms | watchdog 1,500 ms |

- **Machine:** 13th Gen Intel Core i7-13620H (12 threads), 6 GB RAM, Linux x86_64,
  Node v24.13.0. CI-class hardware is slower; the relative invariants above are
  what the suite asserts.
- **Margin against the watchdog:** the worst measured case (13.483 ms p95-max on
  a 666 KB input) is **> 100×** inside `WATCHDOG_MS` (1,500 ms) — the terminate +
  respawn path exists for a pathological parse, not for this one.
- **The oversize case proves the cap:** 666,974 B in → 262,144 B analyzed, with
  the original byte count reported (SPEC §9 AC-13). The cut lands on a code-point
  boundary; `_lib/__tests__/analyze.test.ts` asserts no lone surrogate survives.

## Gate semantics (SPEC §9 AC-11)

- `WORKER_DEADLINE_MS` (1,000 ms) is a **measured / WARN threshold**, not a hard
  gate — the worker self-reports and the UI shows the friendly verdict.
- The default-path assertion is **relative**: the 5,000-line case completes in
  < 0.5 × `WORKER_DEADLINE_MS` and the 1,000-line case in < 0.25 ×, on whatever
  machine runs it.
- `WATCHDOG_MS` (1,500 ms) is the hard wall: terminate + respawn, never a hang.

## Build & suite timings (same machine)

| Command | Result |
|---|---|
| `npm run build` | ~12 s, standalone output at `.next/standalone` |
| `npm test` (7 suites, 89 tests) | ~0.4 s |
| `npm run test:e2e` (21 passed, 2 skipped) | ~3 min (includes the standalone build the webServer boots) |
| First Load JS, `/tools/anchorflow` | 180 kB (103 kB shared) |

## Bundle budget — how the happy path stays tiny

`context.md` §4.1 sets an initial-JS budget of ≤ 200 kB. `/tools/anchorflow`
ships **180 kB** First Load JS (103 kB of it the shared Next.js/React framework
chunks) — 20 kB under the budget, and smaller than the RegexCraft reference
route it mirrors.

Nothing heavy is reachable from the first paint. Measured from
`.next/app-build-manifest.json`:

| Slice | Where it lives | Reason |
|---|---|---|
| eemeli `yaml` + the audits + the resolver core | the **worker chunk**, loaded only by the worker | the compute runs off the main thread |
| the same core, for the degraded path | an **on-demand chunk** fetched by `degradeToMainThread` | degradation is rare, so it is never paid up front |
| `framer-motion` (toast animation) | an **on-demand chunk** fetched on the first toast | a copy-failure toast is a rare event |
| `@supabase/supabase-js` | an **on-demand chunk** fetched on sign-in | OAuth is an offer, never a gate |

What remains in first load is the framework plus the workstation chrome. The
reduction from 261 kB to 180 kB came from three changes, in order of effect:
the timeout copy moved out of `_lib/analyze.ts` into pure
`_lib/constants.ts` (so `useToolWorker` no longer statically imported the
parser), the toast animation split behind a lazy boundary, and the resolver
already being a dynamic import.
