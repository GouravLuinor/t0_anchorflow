// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the SHA-seeded guilloché seal (pure geometry, unit-tested).
//
// Each pinned action wears a seal drawn from its own commit SHA: the same SHA
// always draws the same rosette, and a different SHA draws a visibly different
// one, so a reviewer can tell two pins apart at a glance before reading hex.
// The seal is decoration of a FACT (the SHA), never a claim of verification —
// the receipt is the proof.
//
// Output is a set of SVG path strings in a 0…100 viewBox. No DOM, no React.
// ─────────────────────────────────────────────────────────────────────────────

export interface SealGeometry {
  /** The interleaved rosette curves, outermost first. */
  curves: string[];
  /** Radius of the inner guard ring. */
  innerRadius: number;
  /** Radius of the outer border ring. */
  outerRadius: number;
}

const CENTER = 50;
const POINTS_PER_CURVE = 180;

/** 20 bytes from a 40-hex SHA; any other string is hashed into 20 bytes. */
export function sealBytes(seed: string): number[] {
  const hex = seed.trim().toLowerCase();
  if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(hex)) {
    const bytes: number[] = [];
    for (let i = 0; i < 40; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
    return bytes;
  }
  // FNV-1a, re-mixed per byte, for non-SHA seeds such as the brand mark.
  const bytes: number[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < seed.length; j++) {
      h ^= seed.charCodeAt(j) + i;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    bytes.push(h & 0xff);
  }
  return bytes;
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** The rosette for one seed. Deterministic: same seed, same strings. */
export function sealGeometry(seed: string): SealGeometry {
  const b = sealBytes(seed);
  const lobes = 5 + (b[0] % 8); // 5…12 petals
  const harmonic = lobes * 2 + 1 + (b[1] % 4); // the finer interference wave
  const copies = 3 + (b[2] % 2); // 3 or 4 interleaved curves
  const a1 = 0.16 + (b[3] / 255) * 0.1;
  const a2 = 0.05 + (b[4] / 255) * 0.07;
  const phase2 = (b[5] / 255) * Math.PI * 2;
  const outerRadius = 47;
  const innerRadius = 12 + (b[6] % 8);
  const base = outerRadius - (a1 + a2) * outerRadius - 2;

  const curves: string[] = [];
  for (let c = 0; c < copies; c++) {
    const rot = ((b[7 + c] / 255) * 2 * Math.PI) / lobes + (c * Math.PI) / (lobes * copies);
    let d = "";
    for (let i = 0; i <= POINTS_PER_CURVE; i++) {
      const t = (i / POINTS_PER_CURVE) * Math.PI * 2;
      const r =
        base +
        outerRadius * a1 * Math.sin(lobes * t + rot * lobes) +
        outerRadius * a2 * Math.sin(harmonic * t + phase2 + c);
      const x = CENTER + r * Math.cos(t);
      const y = CENTER + r * Math.sin(t);
      d += `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
    }
    curves.push(`${d}Z`);
  }

  return { curves, innerRadius, outerRadius };
}
