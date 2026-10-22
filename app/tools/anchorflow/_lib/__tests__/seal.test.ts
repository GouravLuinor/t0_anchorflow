import { describe, expect, it } from "vitest";
import { sealBytes, sealGeometry } from "../seal";

const CHECKOUT = "11bd71901bbe5b1630ceea73d27597364c9af683";
const SETUP_NODE = "49933ea5288caeca8642d1e84afbd3f7d6820020";

function coordinates(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

describe("sealBytes", () => {
  it("reads a 40-hex SHA as its own 20 bytes", () => {
    const bytes = sealBytes(CHECKOUT);
    expect(bytes).toHaveLength(20);
    expect(bytes[0]).toBe(0x11);
    expect(bytes[19]).toBe(0x83);
  });

  it("hashes any other seed into 20 bytes, deterministically", () => {
    expect(sealBytes("anchorflow")).toEqual(sealBytes("anchorflow"));
    expect(sealBytes("anchorflow")).toHaveLength(20);
    expect(sealBytes("anchorflow")).not.toEqual(sealBytes("anchorflow2"));
  });
});

describe("sealGeometry", () => {
  it("draws the same seal for the same SHA", () => {
    expect(sealGeometry(CHECKOUT)).toEqual(sealGeometry(CHECKOUT));
  });

  it("draws a different seal for a different SHA", () => {
    expect(sealGeometry(CHECKOUT).curves).not.toEqual(sealGeometry(SETUP_NODE).curves);
  });

  it("stays inside the 0…100 viewBox", () => {
    for (const seed of [CHECKOUT, SETUP_NODE, "brand", "f".repeat(40), "0".repeat(40)]) {
      const { curves, innerRadius, outerRadius } = sealGeometry(seed);
      expect(curves.length).toBeGreaterThanOrEqual(3);
      expect(innerRadius).toBeLessThan(outerRadius);
      for (const curve of curves) {
        for (const n of coordinates(curve)) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
