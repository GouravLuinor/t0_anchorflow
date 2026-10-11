# Anchorflow — tutorial

A five-minute walkthrough of the workstation: what each pane does, what the
keyboard shortcuts are, and the four habits the guide below the fold teaches.

## Contents

1. [The workstation, in one paragraph](#1-the-workstation-in-one-paragraph)
2. [Your first analysis](#2-your-first-analysis)
3. [Reading the diagnostic pane](#3-reading-the-diagnostic-pane)
4. [Copying, everywhere](#4-copying-everywhere)
5. [Keyboard-first](#5-keyboard-first)
6. [Where the result comes from](#6-where-the-result-comes-from)
7. [What the resolver sends, and when](#7-what-the-resolver-sends-and-when)

---

## 1. The workstation, in one paragraph

The page is one instrument. A sticky header carries navigation and the theme
toggle. Below it, a single card holds the toolbar, your input pane and the
diagnostic pane. Everything else on the page — the comparison matrix, the guide
and the FAQ — is the education that makes the card trustworthy.

## 2. Your first analysis

The editor opens with an example workflow already in it, so the instrument is
never blank. Replace it by pasting your own `.github/workflows/ci.yml`, or clear
it and start from scratch.

Paste is the whole interaction: the moment the text lands, the worker behind the
card starts working. There is no "Run" button. The example was chosen to
exercise everything the offline pass reports — a moving ref, a pinned SHA, a
local action, a Docker step, an over-broad grant and an untrusted interpolation —
so the first paint already shows real findings.

## 3. Reading the diagnostic pane

The right-hand pane is a mirror of exactly what the worker computed — nothing is
recomputed or decorated on the way out. From top to bottom:

- **the four plain measurements** — characters, words, bytes (the UTF-8 length,
  which is what actually crosses the worker boundary) and lines;
- **the amber scan-cap strip**, only when a workflow carries more than 2,000
  `uses:` nodes: it states how many were analysed and how many were not, because
  a cap that hides its own remainder would be a lie by omission;
- **the findings**, worst-first with a one-line severity legend under the
  header, each with a plain-English detail, a `# line N` location and a
  remediation you can copy with one click;
- **the grant table** — the effective `GITHUB_TOKEN` scope per job, and which
  block it came from;
- **the `uses:` classification** — every step and job-level reference with its
  class badge and its `# line N`;
- **the resolution receipts**, once you have resolved: the endpoint chain, the
  SHA and the `git ls-remote` line that reproduces it;
- **the rewritten YAML and its diff** — red/green, empty until refs are
  resolved.

When your input is very large, the editor notes that it was trimmed to the
analysis cap — the original byte count is always reported, never hidden. Only
the first 256 KiB is analysed; the byte reading in the footer is the size of
what you pasted, whether the analysis ran in the worker or on the main thread.
The footer also reports the engine time and which of the two ran the job.

## 4. Copying, everywhere

Three ways to take the result with you:

- the **Copy** button in the diagnostic pane's header;
- a **Copy** button per finding, for a single remediation;
- **⌘⇧C** (or `Ctrl+Shift+C`) from anywhere on the page.

All of them go through the same clipboard helper — the async Clipboard API, with
a hidden-textarea fallback for non-secure contexts — and all confirm with a lime
toast. A failure is a rose toast, never a silent nothing.

## 5. Keyboard-first

| Chord | Action |
|---|---|
| `⌘K` / `⌃K` | Command palette — navigate, copy, toggle the theme, insert the example, **resolve & pin** |
| `⌘P` / `⌃P` | Insert the example workflow |
| `⌘⇧C` / `⌃⇧C` | Copy the current diagnostic output |
| `⌘↵` / `⌃↵` | Jump back to the editor |
| `⌘⏎` / `⌃⏎` | **inside the palette**: run Resolve & pin directly (inert when nothing is pending) |

Inside the palette, arrow keys move, `↵` selects, `Esc` closes. A palette entry
that cannot run right now is listed but inert — it explains why rather than
disappearing.

## 6. Where the result comes from

Your workflow text never leaves the tab. The measurement runs in a Web Worker,
so the page stays responsive while it works, and the store keeps only your text
and the resolve opt-in — results, timings and worker health are never persisted.

If the worker is unavailable, the same core runs on the main thread and the card
says so in an amber banner; the answer does not change, only the thread it came
from. If the worker accepts a job and then never answers — the pathological
case — a 1.5-second watchdog terminates it, respawns it, and settles the
friendly "analysis exceeded the time budget" verdict with your editor still
usable. Neither path ever hangs.

## 7. What the resolver sends, and when

**By default, nothing is sent.** The first paint, typing and computing all make
zero network requests — asserted in the default CI path, not merely intended.
The resolver is off until you ask for it.

**When you opt in**, pressing **Resolve & pin** (or enabling auto-resolve) sends
exactly one thing, once per unique `owner/repo@ref`: that string, to
`api.github.com`, to ask which commit the ref points at. The request is a plain
unauthenticated read from your own browser — no account, no token, no server in
between. Nothing about your workflow, your file, your host or your identity is
included; the only thing GitHub learns is which public action you looked up.

**The quota is yours, not ours:** that is roughly **60 lookups per hour per
visitor IP**, shared by everyone behind the same NAT. When it runs out, the tool
says so with a countdown and leaves the offline report complete — it never
silently blanks what it already computed.
