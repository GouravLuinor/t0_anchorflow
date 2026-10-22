import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Anchorflow — "Certified Copy" token layer. Every colour resolves to an RGB
 * triplet in app/globals.css (:root light, .dark dark), so `/opacity`
 * modifiers work in both themes. Colours come ONLY from these names; the
 * default Tailwind palette is replaced, not extended, so a stray `text-zinc-*`
 * or `bg-blue-*` simply does not exist.
 */
const rgb = (token: string) => `rgb(var(${token}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      paper: rgb("--paper"),
      sheet: rgb("--sheet"),
      sunk: rgb("--sunk"),
      band: rgb("--band"),
      line: rgb("--line"),
      "line-strong": rgb("--line-strong"),
      ink: rgb("--ink"),
      "ink-2": rgb("--ink-2"),
      "ink-3": rgb("--ink-3"),
      seal: rgb("--seal"),
      "on-seal": rgb("--on-seal"),
      moving: rgb("--moving"),
      critical: rgb("--critical"),
      major: rgb("--major"),
    },
    extend: {
      fontFamily: {
        sans: [
          "var(--font-schibsted)",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: [
          "var(--font-martian)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        DEFAULT: "2px",
      },
      boxShadow: {
        // Overlays only (palette, dialogs, toasts). Panels never cast shadows.
        pop: "0 18px 48px -12px rgb(var(--ink) / 0.28), 0 2px 6px rgb(var(--ink) / 0.08)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
