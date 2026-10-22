---
name: Anchorflow
description: Pin GitHub Actions to commit SHAs in the browser, printed as a certified copy of your workflow.
colors:
  paper: "rgb(238 242 236)"
  sheet: "rgb(251 252 250)"
  sunk: "rgb(227 233 225)"
  band: "rgb(230 236 228)"
  line: "rgb(201 211 200)"
  line-strong: "rgb(159 178 163)"
  ink: "rgb(16 35 28)"
  ink-2: "rgb(58 85 73)"
  ink-3: "rgb(83 107 96)"
  seal: "rgb(31 107 79)"
  on-seal: "rgb(255 255 255)"
  moving: "rgb(75 79 168)"
  critical: "rgb(181 50 27)"
  major: "rgb(138 90 0)"
typography:
  display:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  heading:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  verdict:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  data:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
    fontStretch: "87.5%"
rounded:
  DEFAULT: "2px"
  full: "9999px"
spacing:
  gutter-mobile: "16px"
  gutter-desktop: "32px"
  section: "64px"
  content-max: "1400px"
components:
  button-primary:
    background: "seal"
    color: "on-seal"
    radius: "2px"
    height: "40px"
  button-outline:
    background: "transparent"
    border: "1px line-strong"
    color: "ink"
  ledger-row:
    seal: "28px"
    rule: "1px line"
  receipt:
    background: "sunk / 0.7"
    border: "1px line"
---

# Anchorflow design system: Certified Copy

## Overview

**Creative North Star: "A certified copy of your workflow."**

Anchorflow is security printing. A share certificate, a passport page, a bank
draft: pale tinted paper, intaglio ink, fine guilloché lattices that are hard to
counterfeit, and a seal that says this copy matches the original. Pinning an
action is the same act: you trade a ref that can move for a commit that
cannot, and you want proof. The page hands back exactly that, a certified copy
of the pasted workflow with a seal on every pin and a receipt for how each one
was resolved.

It is an Operate surface first. The workstation is the first viewport: the
pasted workflow on the left, the certified copy on the right, one sentence of
verdict and one next step at the top. Expression lives in precise details (the
seals, the guilloché rule, the ink), never in decoration that competes with
the YAML.

**Key Characteristics:**

- Security-paper green ground, intaglio-green ink, one seal green.
- Every pinned row wears a guilloché seal generated from its own SHA.
- Machine data in condensed Martian Mono; everything else in Schibsted Grotesk.
- 2px corners, 1px rules, no panel shadows.
- A verdict sentence leads; the ledger and the report follow.

## Colors

Each colour has one job. Values are RGB triplets on `:root` (light) and `.dark`
(intaglio night) in `app/globals.css`; Tailwind's palette is replaced by these
names only.

| Token | Light | Dark | Job |
|---|---|---|---|
| paper | 238 242 236 | 13 22 19 | Page ground (security paper) |
| sheet | 251 252 250 | 18 29 25 | The certified copy, the workstation sheet |
| sunk | 227 233 225 | 10 17 14 | Code wells, receipts, the editor |
| band | 230 236 228 | 16 27 23 | Header and footer band |
| line | 201 211 200 | 36 54 48 | Hairline rules |
| line-strong | 159 178 163 | 53 80 70 | Control borders, scrollbars |
| ink | 16 35 28 | 227 236 230 | Body and headings |
| ink-2 | 58 85 73 | 169 189 178 | Secondary copy |
| ink-3 | 83 107 96 | 138 161 150 | Muted data (line numbers, stamps) |
| seal | 31 107 79 | 98 199 156 | Pinned, primary action, focus |
| on-seal | 255 255 255 | 6 20 14 | Text on seal |
| moving | 75 79 168 | 165 168 242 | An unpinned, floating ref |
| critical | 181 50 27 | 255 143 115 | Critical findings, refused refs, copy failure |
| major | 138 90 0 | 233 182 90 | Major findings, scan cap, rate limit, truncation |

**The One Job Rule.** Seal green means pinned or primary; indigo means moving;
vermilion and ochre are finding grades. No colour is borrowed for decoration.

**The Measured Contrast Rule.** Every text role clears 4.5:1 on paper, sheet,
band and the composited wells and tints, in both themes.
`app/tools/anchorflow/__tests__/contrast.test.ts` parses `globals.css` and
fails the build when one does not.

## Typography

- **Schibsted Grotesk** (variable, 400–800) for all UI. The H1 is 800 weight,
  tight tracking, phrased as the search intent: "Pin GitHub Actions to commit
  SHAs, in your browser".
- **Martian Mono** at `font-stretch: 87.5%` for YAML, SHAs, refs, endpoints,
  receipts and line numbers. A 40-hex SHA fits on one line at 12px.
- `.figures` sets tabular numerals where numbers align (stamps, counts). It is
  not set on the body: Schibsted's tabular figures space punctuation oddly.

**The Machine Data Rule.** Mono means a machine wrote it. A label, a heading or
a button is never mono.

## Layout

- One centred column, `max-w-[1400px]`, gutters 16px mobile, 24px sm, 32px lg.
- First viewport: H1 + a one-line sub + three promises (Never uploaded · No
  account · Free), then the workstation.
- The workstation is a 40/60 grid at `lg` (editor | certified copy). The editor
  is sticky on large screens; below `lg` the two stack.
- The certified copy: verdict → resolve/copy → auto-resolve switch → uses
  ledger → report tabs (Findings · Token grants · Pinned file · Diff).
- Below: Compare (table on md+, one `<details>` per criterion on mobile), the
  pinning guide with links to the six learn pages, FAQ, family footer.
- Long lists collapse: the ledger after 8 rows, findings after 4. On phones a
  finding's reasoning folds behind "Why"; its title, place and fix stay.
- Grid tracks are `minmax(0,1fr)` so a wide code block scrolls inside its well
  and never widens the page.

## Elevation & Depth

Flat. Depth is paper on paper: `sheet` on `paper`, `sunk` wells inside the
sheet, separated by 1px rules. `shadow-pop` exists for overlays (the command
palette, dialogs, toasts) and nowhere else.

## Shapes

- 2px radius everywhere (`rounded`), `rounded-full` only for severity marks
  and the switch.
- **The guilloché rule**: two interleaved sine lattices in seal ink at low
  strength, 8px tall, under the header and above the footer. It is the only
  place the pattern appears outside a seal; it is never wallpaper.
- **The seal** (`_lib/seal.ts` → `_components/Seal.tsx`): 20 bytes of the SHA
  pick 5–12 lobes, a harmonic and 3–4 rotated polar curves in a 0–100 viewBox.
  The same SHA always draws the same seal, so a changed pin looks changed. An
  unpinned ref wears an open, dashed ring in `moving`.

## Motion

One authored motion: a seal drawing itself in (420ms stroke-dashoffset,
`cubic-bezier(0.16,1,0.3,1)`) when its pin lands in this session. Everything
else is a 150ms colour transition. A global kill-switch collapses every
animation and transition under `prefers-reduced-motion`.

## Components

- **Buttons**: `primary` (seal fill, on-seal text), `outline` (line-strong
  border), `ghost`. Sizes sm (32px), default (40px), icon (36px). Focus is the global
  2px seal outline.
- **Ledger row**: 28px seal | action@ref in mono + state label in its colour |
  line number. The full SHA shows for a pin made this session; an existing pin
  shows its `# vX` comment.
- **Receipt**: sunk well under a resolved row: the API hop chain, the full
  commit (and tag object when annotated), a note on what the snapshot means, a
  copyable `git ls-remote` check, `resolvedAt`.
- **Tabs**: underline tabs, force-mounted panels (copy and tests read hidden
  panels).
- **Notice**: 1px tinted border + 10% tint, a triangle icon, ink text. Used
  for the scan cap, the rate limit, the main-thread fallback.
- **Family footer**: Nor AI mark + "Built by Nor AI", the guides, and "More
  free tools" with each tool's one-liner, on the band with the guilloché rule.

## Do's and Don'ts

**Do:**

- Lead the certified copy with one sentence and one next step.
- Say loading when loading, and name the error and where it is.
- Show the receipt for every network-resolved pin.
- Keep every claim in the comparison true of the category, not a named brand.

**Don't:**

- Use eyebrows, icon-card grids, hero metrics, 01/02 numbering, gradient text,
  glass, or a coloured border-left over 1px.
- Use the guilloché pattern as a background.
- Use mono for labels or headings.
- Open a modal the visitor did not ask for.
