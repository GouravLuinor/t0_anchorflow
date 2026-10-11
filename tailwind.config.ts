import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Anchorflow — Matchlight dual-theme token layer (copied verbatim from the
 * RegexCraft reference; only the file header comment differs).
 *
 * Semantic tokens resolve to space-separated RGB triplets declared in
 * globals.css (:root = light, .dark = dark). Wrapping with
 * `rgb(var(--token) / <alpha-value>)` keeps every `/opacity` modifier working
 * in both themes.
 *
 * Colors come ONLY from these token classes — no default Tailwind palette,
 * no raw named palettes (sky/emerald/indigo/…). The inverted zinc scale below
 * is the single exception and the only permitted neutral.
 */
const rgb = (token: string) => `rgb(var(${token}) / <alpha-value>)`;

/**
 * Inverted zinc scale. :root (light) defines dark-on-light values and .dark
 * overrides the same `--zinc-inv-*` names to light-on-dark, so a single
 * variable name flips with the theme (no reliance on a CSS fallback, which
 * would not trigger because :root already defines the var).
 *
 * Conventions: text-zinc-100 = headings · -300 = secondary · -400 = muted
 * labels · -500 = faint mono captions.
 */
const zincInverted: Record<number, string> = {
  50: "rgb(var(--zinc-inv-50) / <alpha-value>)",
  100: "rgb(var(--zinc-inv-100) / <alpha-value>)",
  200: "rgb(var(--zinc-inv-200) / <alpha-value>)",
  300: "rgb(var(--zinc-inv-300) / <alpha-value>)",
  400: "rgb(var(--zinc-inv-400) / <alpha-value>)",
  500: "rgb(var(--zinc-inv-500) / <alpha-value>)",
  600: "rgb(var(--zinc-inv-600) / <alpha-value>)",
  700: "rgb(var(--zinc-inv-700) / <alpha-value>)",
  800: "rgb(var(--zinc-inv-800) / <alpha-value>)",
  900: "rgb(var(--zinc-inv-900) / <alpha-value>)",
  950: "rgb(var(--zinc-inv-950) / <alpha-value>)",
};

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: rgb("--canvas"),
        canvas: rgb("--canvas"),
        ink: rgb("--ink"),
        surface: {
          base: rgb("--surface-base"),
          subtle: rgb("--surface-subtle"),
          default: rgb("--surface-default"),
          elevated: rgb("--surface-elevated"),
          border: rgb("--surface-border"),
          borderHover: rgb("--surface-border-hover"),
        },
        brand: {
          lime: rgb("--brand-lime"),
          violet: rgb("--brand-violet"),
          amber: rgb("--brand-amber"),
          rose: rgb("--brand-rose"),
        },
        code: {
          keyword: rgb("--code-keyword"),
          type: rgb("--code-type"),
          prop: rgb("--code-prop"),
          str: rgb("--code-str"),
          num: rgb("--code-num"),
          punct: rgb("--code-punct"),
          comment: rgb("--code-comment"),
        },
        zinc: zincInverted,
      },
      boxShadow: {
        // Keycap tactility — the one documented shadow exception (DESIGN.md §4).
        // Theme-aware: a dark keycap needs a dark drop and a dark inset.
        raycast: "var(--shadow-raycast)",
        elevated: "0 12px 40px rgb(var(--ink) / 0.10)",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-jetbrains-mono)",
          '"JetBrains Mono"',
          '"Fira Code"',
          "Menlo",
          "Monaco",
          "Consolas",
          '"Courier New"',
          "monospace",
        ],
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        150: "150ms",
        180: "180ms",
        300: "300ms",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
