import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The contrast floor, measured from the SHIPPED `app/globals.css` values.
 *
 * The Certified Copy tokens are RGB triplets on `:root` (light) and `.dark`, so
 * this suite parses that one file and computes the real WCAG 2.1 ratios for
 * every text role on every ground it is painted on, including the composited
 * tints (the editor well, the diff rows, the notices). A claim in DESIGN.md
 * that a colour "clears AA" is a TEST here.
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

const TEXT_ROLES = ["ink", "ink-2", "ink-3", "seal", "moving", "critical", "major"] as const;

/** Every ground a text role is painted on, composited the way the page paints it. */
function grounds(t: Record<string, Rgb>): Record<string, Rgb> {
  const sunkOnSheet = over(t["sunk"], t["sheet"], 0.7);
  return {
    paper: t["paper"],
    sheet: t["sheet"],
    band: t["band"],
    "editor well (sunk/60 on sheet)": over(t["sunk"], t["sheet"], 0.6),
    "code well (sunk/70 on sheet)": sunkOnSheet,
    "compare column (seal/10 on sheet)": over(t["seal"], t["sheet"], 0.1),
    "notice (major/10 on sheet)": over(t["major"], t["sheet"], 0.1),
  };
}

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
] as const)("contrast — %s theme", (_name, tokens) => {
  it("ink clears 12:1 on paper (AAA body text)", () => {
    expect(ratio(tokens["ink"], tokens["paper"])).toBeGreaterThan(12);
  });

  for (const [groundName, ground] of Object.entries(grounds(tokens))) {
    it(`every text role clears AA on ${groundName}`, () => {
      for (const role of TEXT_ROLES) {
        expect(ratio(tokens[role], ground), `${role} on ${groundName}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("diff lines clear AA on their own tinted rows", () => {
    const well = over(tokens["sunk"], tokens["sheet"], 0.7);
    expect(ratio(tokens["seal"], over(tokens["seal"], well, 0.1))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens["critical"], over(tokens["critical"], well, 0.1))).toBeGreaterThanOrEqual(4.5);
  });

  it("the primary button label clears AA on seal", () => {
    expect(ratio(tokens["on-seal"], tokens["seal"])).toBeGreaterThanOrEqual(4.5);
  });

  it("the inverted toggle (paper on ink) clears AA", () => {
    expect(ratio(tokens["paper"], tokens["ink"])).toBeGreaterThanOrEqual(4.5);
  });
});
