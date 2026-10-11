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
Ink on canvas clears **16.8:1** (light) and **16.5:1** (dark) — measured, not
claimed; every secondary and muted zinc step used by the shipped surface clears
**4.5:1 AA** on the surface it renders on. All of it is asserted by
`app/tools/anchorflow/__tests__/contrast.test.ts`, which parses the shipped
`app/globals.css` and computes the WCAG 2.1 ratios of the pairs the UI actually
renders.

**What is NOT claimed:** the whole ladder is not AAA. The faint mono captions
(`text-zinc-500`, the status-strip separators) are **4.6:1 light / 5.1:1 dark** —
AA, deliberately, because they are decoration-grade hints. `text-zinc-600` failed
AA (3.0:1 / 3.6:1) and was retired from the separators on that evidence; the test
keeps it retired by asserting it stays below 4.5:1.

## 2. Token ladder

Tokens are space-separated RGB triplets declared on `:root` (light) and
overridden on `.dark` (same names, flipped values). Tailwind consumes them via
`rgb(var(--token) / <alpha-value>)` so every `/opacity` modifier works in both
themes.

| Class | CSS var | Light | Dark |
|---|---|---|---|
| `bg-canvas` | `--canvas` | `#fafaf7` | `#0c0e0b` |
| `text-ink` | `--ink` | `#181a15` | `#eceee4` |
| `bg-surface-base` | `--surface-base` | `#ffffff` | `#12140f` (`18 20 15`) |
| `bg-surface-subtle` | `--surface-subtle` | `#f4f4ee` | `#171a14` |
| `bg-surface-default` | `--surface-default` | `#ffffff` | `#1b1e18` |
| `bg-surface-elevated` | `--surface-elevated` | `#fafaf6` | `#242820` |
| `border-surface-border` | `--surface-border` | `#e2e2d8` | `#2e3328` |
| `border-surface-borderHover` | `--surface-border-hover` | `#cbcbbd` | `#42493a` |
| `brand-lime` | `--brand-lime` | `#3f6212` | `#a3e635` (`163 230 53`) |
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
- **violet** = **pending resolution** (a remote ref the resolver has not
  dispatched yet) and **minor** severity in the findings bands. The grant table's
  secondary column is *not* violet: it is ink/zinc, and nothing else borrows the
  colour.
- **amber** = warn / degraded / the input truncation / the `uses:` scan cap / the
  rate-limit banner.
- **rose** = error finding / copy failure / a ref refused by the path-safety gate.
  (Nothing in the shipped surface is a "rejected analysis" — that state is the
  friendly parse error, which is amber-bordered with zinc copy.)

A state colour appearing where it does not mean that thing is a bug.

## 3. Neutrals & typography

- **Inverted zinc is the only permitted neutral.** `:root` defines dark-on-light
  values and `.dark` overrides the same `--zinc-inv-*` names, so one class name
  flips with the theme. Conventions: `text-zinc-100` headings · `-300` secondary
  · `-400` muted · `-500` faint mono captions. No raw named palettes anywhere.
- Measured contrast on the surfaces those roles actually render on (the diagnostic
  pane body for `-300/-400`, the composited workstation status strip for `-500`):
  | Step | Light | Dark |
  |---|---|---|
  | `text-zinc-300` | 10.3:1 | 11.2:1 |
  | `text-zinc-400` | 6.5:1 | 7.5:1 |
  | `text-zinc-500` | 4.6:1 | 5.1:1 |
  | `text-zinc-600` (retired from separators) | 3.0:1 | 3.6:1 |
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

- `.glass-edge` = one inset white hairline (`rgb(255 255 255 / 0.9)` light /
  `0.05` dark) + one soft shadow. The shipped shadow differs per theme and
  carries the ink colour, not a neutral black:
  - light: `0 12px 40px rgb(var(--ink) / 0.10)`
  - dark: `0 12px 40px rgb(0 0 0 / 0.45)`
  It is a machined edge, not frosted glass. `.glass-edge-subtle` is the hairline
  alone, also theme-independent.
- Blur is permitted in exactly two functional places: the sticky header
  (`bg-canvas/80 backdrop-blur-md`) and the command-palette scrim
  (`bg-canvas/70 backdrop-blur-sm`). No card joins them.
- Elevation is declared once — border **or** shadow, not both. No decorative
  glow, no spotlight, no gradient fills.
- **The one tactile exception, documented:** `components/ui/keycap.tsx` carries
  `shadow-raycast`, a real token — `--shadow-raycast` is declared on `:root` and
  `.dark` in `app/globals.css` (the two-theme pattern every other value here
  uses) and mapped through `tailwind.config.ts`, not an arbitrary value in a
  class string. A keycap is a *key*: it is the only element in the system the
  visitor is invited to press, and the 1px inset plus a 2px drop is what makes it
  read as raised rather than as a label. The inset frays to `0.05` in dark, like
  `.glass-edge`. It replaced the inline
  `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]`, which was a literal smuggled
  into a class string that ignored the dark theme entirely.

### Two documented exceptions

1. **Keycap tactility** (above) — a shadow on one element.
2. **The Google provider mark is monochrome.** The OAuth button renders the
   provider's *shape* through four paths filled with `currentColor`, not the
   provider's brand hexes (`#4285F4` / `#34A853` / `#FBBC05` / `#EA4335`). The
   shape is the provider's; the colour is ours — Matchlight spends one accent and
   inverts zinc as its only neutral, and a multi-hue glyph would be the single
   place the ladder breaks. `SignInButton.tsx` carries the rationale in the file.

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
| `components/ui/keycap.tsx` | keyboard hints; `xs` for the status strip, `sm`/`md` in docs. Its `shadow-raycast` is the one documented tactile exception to §4's "border **or** shadow" rule — see §4 above |
| `components/ui/dialog.tsx` | Radix dialog — the palette + sign-in modal |
| `components/ui/switch.tsx` | Radix switch — the auto-resolve opt-in |
| `components/ui/tabs.tsx` | Radix tabs — the KnowledgeHub guide |
| `components/ui/tooltip.tsx` | Radix tooltip — control hints |
| `components/ui/skeleton.tsx` | the processing state in the diagnostic pane |
| `components/ui/toast.tsx` | the copy feedback (lime success, rose failure) |
| `components/ui/badge.tsx` | **reserved — not currently mounted.** Ships no use; kept as the reference for a semantic badge |
| `components/ui/input.tsx` | **reserved — not currently mounted** |
| `components/ui/textarea.tsx` | **reserved — not currently mounted** (the editor is a styled native `<textarea>` in `RawEditorPane`) |
| `components/ui/dropdown-menu.tsx` | **reserved — not currently mounted** |

A primitive marked *reserved* is not a bug: it is Mounted-and-unused debt that
must stay in the ladder's language, so any future mount needs no new styling
decision. Anything mounted without a row here is the bug.
