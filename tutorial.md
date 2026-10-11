# Anchorflow — tutorial

A five-minute walkthrough of the workstation: what each pane does, what the
keyboard shortcuts are, and the four habits the guide below the fold teaches.

## Contents

1. [The workstation, in one paragraph](#1-the-workstation-in-one-paragraph)
2. [Your first analysis](#2-your-first-analysis)
3. [Reading the diagnostic mirror](#3-reading-the-diagnostic-mirror)
4. [Copying, everywhere](#4-copying-everywhere)
5. [Keyboard-first](#5-keyboard-first)
6. [Where the result comes from](#6-where-the-result-comes-from)
7. [What ships next](#7-what-ships-next)

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
card starts measuring it. There is no "Run" button.

## 3. Reading the diagnostic mirror

The right-hand pane is a mirror of exactly what the worker computed — nothing is
recomputed or decorated on the way out. Today that is the placeholder
measurement:

- **characters** — how long the analyzed text is.
- **words** — whitespace-delimited word count.
- **bytes** — the UTF-8 byte length, which is what actually crosses the
  worker boundary.
- **lines** — newline-delimited line count.

Underneath, the analyzed text itself is echoed back, and the footer reports the
engine time and whether the worker or the main-thread fallback ran the job.

When your input is very large, the editor notes that it was trimmed to the
analysis cap — the original byte count is always reported, never hidden.

## 4. Copying, everywhere

Two ways to take the result with you:

- the **Copy** button in the diagnostic pane's header;
- **⌘⇧C** (or `Ctrl+Shift+C`) from anywhere on the page.

Both go through the same clipboard helper — the async Clipboard API, with a
hidden-textarea fallback for non-secure contexts — and both confirm with a lime
toast. A failure is a rose toast, never a silent nothing.

## 5. Keyboard-first

| Chord | Action |
|---|---|
| `⌘K` / `⌃K` | Command palette — navigate, copy, toggle the theme, insert the example |
| `⌘P` / `⌃P` | Insert the example workflow |
| `⌘⇧C` / `⌃⇧C` | Copy the current diagnostic output |
| `⌘↵` / `⌃↵` | Jump back to the editor |

Inside the palette, arrow keys move, `↵` selects, `Esc` closes.

## 6. Where the result comes from

Your workflow text never leaves the tab. The measurement runs in a Web Worker,
so the page stays responsive while it works, and the store keeps only your text
and the resolve opt-in — results, timings and worker health are never persisted.

If the worker is unavailable, the same core runs on the main thread and the card
says so in an amber banner; the answer does not change, only the thread it came
from.

## 7. What ships next

The next pass turns this into the full workstation: parsing that preserves your
comments, classification of every `uses:` reference, resolution of each tag or
branch to the commit it points at today, the permission and injection audits,
the pinned rewrite with a red/green diff, and a per-pin receipt you can
reproduce by hand with `git ls-remote`. The seams for all of it are already in
the code.
