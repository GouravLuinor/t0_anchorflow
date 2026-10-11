# Anchorflow — Design System (docs/DESIGN.md)

> This file describes the design system **as shipped**. If a component and this
> document disagree, the component is the truth — fix this file.
> Machine-readable mirror: `design_tokens.json`. Direction contract (dev-only,
> never shipped into source or metadata): `docs/surface-brief.md`.

## 1. Thesis

Anchorflow is a machined developer workstation, not a marketing page. The visual
language is borrowed wholesale from the Tier-0 sibling bar (RegexCraft's
"Matchlight") so the suite reads as one family: a warm neutral canvas, hairline
machine rules, one reserved accent worn only by pins and primary actions, and
mono type reserved strictly for machine data.

The one requirement above all others: **light and dark are both first-class**.
Ink on canvas clears > 10:1 in both themes (WCAG AAA).

## 2. Token ladder

Tokens are space-separated RGB triplets declared on `:root` (light) and
overridden on `.dark` (same names, flipped values). Tailwind consumes them via
`rgb(var(--token) / <alpha-value>)` so every `/opacity` modifier works in both
themes.

| Class | CSS var | Light | Dark |
|---|---|---|---|
| `bg-canvas` | `--canvas` | `#fafaf7` | `#0c0e0b` |
| `text-ink` | `--ink` | `#181a15` | `#eceee4` |
| `bg-surface-base` | `--surface-base` | `#ffffff` | `#12120f` |
| `bg-surface-subtle` | `--surface-subtle` | `#f4f4ee` | `#171a14` |
| `bg-surface-default` | `--surface-default` | `#ffffff` | `#1b1e18` |
| `bg-surface-elevated` | `--surface-elevated` | `#fafaf6` | `#242820` |
| `border-surface-border` | `--surface-border` | `#e2e2d8` | `#2e3328` |
| `border-surface-borderHover` | `--surface-border-hover` | `#cbcbbd` | `#42493a` |
| `brand-lime` | `--brand-lime` | `#3f6212` | `#bef264` |
| `brand-violet` | `--brand-violet` | `#4f46e5` | `#a78bfa` |
| `brand-amber` | `--brand-amber` | `#92400e` | `#fcd34d` |
| `brand-rose` | `--brand-rose` | `#be123c` | `#fda4af` |
| `code-keyword` | `--code-keyword` | `#9d174d` | `#e879a0` |
| `code-type` | `--code-type` | `#1e3a8a` | `#93c5fd` |
| `code-prop` | `--code-prop` | `#181a15` | `#e4e4e7` |
| `code-str` | `--code-str` | `#046c4e` | `#6ee7b7` |
| `code-num` | `--code-num` | `#9a3412` | `#fde047` |
| `code-punct` | `--code-punct` | `#78716c` | `#9696a0` |
| `code-comment` | `--code-comment` | `#78716c` | `#9696a0` |

`surface-base` and `surface-default` are the same value in light mode **by
intent** (workstation card vs. control well). Do not "optimise" them apart.

### Semantic mapping (Anchorflow-specific)

- **lime** = pinned / match / primary / the privacy promise / a successful copy.
- **violet** = capture / secondary scope (the grant table's secondary column).
- **amber** = warn / degraded / truncation / the rate-limit banner.
- **rose** = error finding / copy failure / a rejected analysis.

A state colour appearing where it does not mean that thing is a bug.

## 3. Neutrals & typography

- **Inverted zinc is the only permitted neutral.** `:root` defines dark-on-light
  values and `.dark` overrides the same `--zinc-inv-*` names, so one class name
  flips with the theme. Conventions: `text-zinc-100` headings · `-300` secondary
  · `-400` muted · `-500` faint mono captions. No raw named palettes anywhere.
- **Inter** for all UI, headings and prose; **JetBrains Mono** for code,
  patterns, metrics, timings, receipts and keycaps (both `next/font/google`,
  `display: "swap"`, latin subset).
- `font-feature-settings: "cv02","cv03","cv04","cv11","tnum"` on the body;
  numeric readouts additionally carry `tabular-nums`.
- `letter-spacing: -0.01em` on body, `-0.025em` on `<h1>`; antialiased on both
  engines.
- Browser surface: `::selection` = `rgb(var(--brand-lime) / 0.25)` + ink text;
  `caret-color: rgb(var(--brand-lime))` (the editor also uses
  `text-brand-lime caret-brand-lime` for pattern-like fields); themed thin
  scrollbars in both WebKit and Firefox. `theme-color` is declared per colour
  scheme (`#fafaf7` / `#0c0e0b`) with `colorScheme: "light dark"`.

## 4. Surfaces, elevation, and the only permitted blur

- `.glass-edge` = one inset white hairline (`0.9` light / `0.05` dark) + one soft
  shadow (`0 12px 40px rgb(var(--ink) / 0.10)`). It is a machined edge, not
  frosted glass.
- Blur is permitted in exactly two functional places: the sticky header
  (`bg-canvas/80 backdrop-blur-md`) and the command-palette scrim
  (`bg-canvas/70 backdrop-blur-sm`). No card joins them.
- Elevation is declared once — border **or** shadow, not both. No decorative
  glow, no spotlight, no gradient fills.

## 5. Motion

| Token | Value |
|---|---|
| Easing (the only curve) | `ease-out-expo` = `cubic-bezier(0.16, 1, 0.3, 1)` |
| Interactive transitions | `150ms` |
| Theme crossfade (body) | `180ms` |
| Slower state changes | `300ms` |
| **The one authored animation** | `.scan-sweep` — a 2 px lime hairline sweeps left→right once (`400ms`, out-expo, `1 both`) when a diagnostic settles |

Transitions are restricted to properties that actually change, e.g.
`transition-[background-color,border-color,color,transform]` — a hover never
animates layout. Reduced motion is a **global kill-switch**, not a speed-up:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 6. The five interaction states (every control)

1. **Idle** — `border-surface-border bg-surface-subtle text-zinc-400`
2. **Hover** — `hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100` (brightness lift, not a jump)
3. **Active/pressed** — `active:scale-[0.97]` (`[0.98]` on larger controls)
4. **Focused** — `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`
5. **Disabled/loading** — `disabled:cursor-not-allowed disabled:opacity-50` (plus `isLoading` on the Button primitive)

The `<details>` summary in `FaqSection` uses `ring-brand-lime/40`; all other
controls use `/70`. One value per control role — do not mix within a role.

## 7. Layout contract

```
SiteHeader (sticky, bg-canvas/80 + backdrop-blur-md)
  → station header: single <h1> + tagline + trust pills
  → one workstation card (TopToolbar + two-pane grid + status strip)
  → CompetitorMatrix (#matrix)
  → KnowledgeHub (#guide)
  → FaqSection (#faq)
  → StudioFooter
```

- `<main>`: `relative w-full overflow-x-hidden flex flex-col gap-4 md:gap-8`
  — **never** a `max-w-*`.
- Every inner section: `mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-8`.
- Workstation grid: `grid grid-cols-1 divide-y divide-surface-border
  lg:h-[620px] lg:grid-cols-2 lg:divide-x lg:divide-y-0` — stacks below `lg`.
- Exactly one `<h1>`; a skip link to `#workstation`; `scroll-mt-20` on anchored
  sections.
- First viewport has one job: paste input → see output. Educational depth (
  matrix, guide, FAQ) lives below the fold.

## 8. The craft floor (8 binding rules)

1. **No eyebrow kickers.** Small uppercase mono labels live only inside tool
   panes as functional measurements ("trimmed to 256 KiB for analysis").
2. **No gradient text.** Headings are solid `--ink` or solid zinc. The only
   gradient is the `scan-sweep` hairline.
3. **No icon-card spine.** Sections are not rows of boxed-icon cards.
4. **No section numbers.** Order comes from layout + sticky anchors.
5. **No decorative glass.** See §4.
6. **Mono is never decorative.** If it is mono, it is machine data.
7. **4px/8px modular grid.** Never arbitrary values.
8. **One accent, semantically spent** (see §2).

## 9. Component inventory

| Component | Role |
|---|---|
| `components/ui/button.tsx` | the canonical five-state button (base string is the reference) |
| `components/ui/keycap.tsx` | keyboard hints; `xs` for the status strip, `sm`/`md` in docs |
| `components/ui/badge.tsx` | severity + classification badges (semantic colour only) |
| `components/ui/dialog.tsx` | Radix dialog — the palette + sign-in modal |
| `components/ui/switch.tsx` | Radix switch — the auto-resolve opt-in |
| `components/ui/tabs.tsx` | Radix tabs — the KnowledgeHub guide |
| `components/ui/textarea.tsx` / `input.tsx` | controlled inputs with the five states |
| `components/ui/tooltip.tsx` | Radix tooltip — control hints |
| `components/ui/skeleton.tsx` | the processing state in the diagnostic pane |
| `components/ui/toast.tsx` | the copy feedback (lime success, rose failure) |
