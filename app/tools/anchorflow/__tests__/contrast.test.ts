import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The contrast floor, measured from the SHIPPED `app/globals.css` values.
 *
 * The Matchlight ladder is defined as space-separated RGB triplets on `:root`
 * (light) and `.dark`, so this suite parses that one file and computes the real
 * WCAG 2.1 contrast ratios for the pairs the UI actually renders. A claim in
 * `docs/DESIGN.md` that a colour "clears AA" is therefore a TEST here, not a
 * sentence someone typed once.
 *
 * What is asserted (and nothing more):
 *   · ink on canvas > 10:1 in BOTH themes (AAA body text);
 *   · the secondary/muted zinc steps (300/400/500) ≥ 4.5:1 on the surfaces they
 *     are used on (AA);
 *   · the retired `text-zinc-600` separator pair is BELOW 4.5:1 — the exact
 *     reason the status-strip `/` glyphs wear zinc-500 today. A regression back
 *     to zinc-600 fails here.
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

type Rgb = [number, number, number];

/** The `--token: r g b` values of one selector block. */
function blockTokens(selector: string): Record<string, Rgb> {
  const start = CSS.indexOf(selector);
  expect(start, `${selector} must exist in globals.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open, close);
  const out: Record<string, Rgb> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[match[1]] = [
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ];
  }
  return out;
}

const LIGHT = blockTokens(":root {");
const DARK = blockTokens(".dark {");

/** WCAG 2.1 relative luminance of an 8-bit RGB triplet. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  );
}

/** WCAG 2.1 contrast ratio between two opaque colours (1…21). */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha composite of `top` over `bottom`, the way the browser paints it. */
function over(top: Rgb, bottom: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(top[i] * alpha + bottom[i] * (1 - alpha))) as Rgb;
}

const ratio = (fg: Rgb, bg: Rgb) => Math.round(contrast(fg, bg) * 100) / 100;

/**
 * The status strip of the workstation card: `bg-surface-subtle/30` painted over
 * the card's `bg-surface-base`. Every separator / caption colour is measured on
 * that composited background, because that is where they render.
 */
const STRIP_LIGHT = over(LIGHT["surface-subtle"], LIGHT["surface-base"], 0.3);
const STRIP_DARK = over(DARK["surface-subtle"], DARK["surface-base"], 0.3);

/** The diagnostic pane body: `bg-surface-base/30` over the workstation card. */
const PANE_LIGHT = over(LIGHT["surface-base"], LIGHT["surface-base"], 0.3);
const PANE_DARK = over(DARK["surface-base"], DARK["surface-base"], 0.3);

describe("contrast — ink on canvas (AAA, both themes)", () => {
  it("light: ink clears 10:1 on the canvas", () => {
    const value = ratio(LIGHT["ink"], LIGHT["canvas"]);
    expect(value).toBeGreaterThan(10);
  });

  it("dark: ink clears 10:1 on the canvas", () => {
    const value = ratio(DARK["ink"], DARK["canvas"]);
    expect(value).toBeGreaterThan(10);
  });
});

describe("contrast — the inverted zinc steps on the surfaces they render on", () => {
  it("zinc-300 (secondary) clears AA on the diagnostic pane in both themes", () => {
    expect(ratio(LIGHT["zinc-inv-300"], PANE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(DARK["zinc-inv-300"], PANE_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("zinc-400 (muted) clears AA on the status strip in both themes", () => {
    expect(ratio(LIGHT["zinc-inv-400"], STRIP_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(DARK["zinc-inv-400"], STRIP_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("zinc-500 (the status-strip separator glyph) clears AA in both themes", () => {
    expect(ratio(LIGHT["zinc-inv-500"], STRIP_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(DARK["zinc-inv-500"], STRIP_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("zinc-600 (retired) does NOT clear AA — it must stay off the separator", () => {
    expect(ratio(LIGHT["zinc-inv-600"], STRIP_LIGHT)).toBeLessThan(4.5);
    expect(ratio(DARK["zinc-inv-600"], STRIP_DARK)).toBeLessThan(4.5);
  });
});

describe("contrast — the brand accent on the canvas", () => {
  it("brand-lime clears AA on the canvas in both themes", () => {
    expect(ratio(LIGHT["brand-lime"], LIGHT["canvas"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(DARK["brand-lime"], DARK["canvas"])).toBeGreaterThanOrEqual(4.5);
  });
});
