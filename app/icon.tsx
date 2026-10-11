import { ImageResponse } from "next/og";

// Matchlight mark — Anchorflow's identity at icon scale.
//
// Concept: the anchor. A lime ring at the crown, a vertical shank, a stock
// crossbar, and the two flukes curving up at the base — the one glyph that
// says "this pins things down". The tile is deep ink (#0c0e0b — the dark
// canvas token), so the mark reads identically on light and dark browser
// chrome; the glyph wears the reserved "matchlight" brand-lime (#bef264 — the
// dark accent token), the one color that exists for pins. Crisp geometric
// strokes only: no gradient, no emoji, no raster assets.
const TILE_BG = "#0c0e0b"; // dark canvas token
const TILE_HAIRLINE = "#2e3328"; // dark surface-border token
const LIME = "#bef264"; // dark brand-lime token — the matchlight accent

const BASE_SIZE = 32;

// The mark is authored at 32px; every dimension scales by `u` so the favicon
// and the apple-touch icon stay pixel-proportional.
export function MatchlightMark({ size }: { size: number }) {
  const u = size / BASE_SIZE;
  const stroke = 2 * u;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: TILE_BG,
        borderRadius: 8 * u,
        border: `${1 * u}px solid ${TILE_HAIRLINE}`,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 22 * u,
          height: 22 * u,
        }}
      >
        {/* crown ring — the anchor's eye */}
        <div
          style={{
            width: 7 * u,
            height: 7 * u,
            borderRadius: 7 * u,
            border: `${stroke}px solid ${LIME}`,
          }}
        />
        {/* shank */}
        <div
          style={{
            width: stroke,
            flex: 1,
            background: LIME,
          }}
        />
        {/* stock crossbar */}
        <div
          style={{
            position: "absolute",
            top: 8.5 * u,
            width: 15 * u,
            height: stroke,
            borderRadius: stroke,
            background: LIME,
          }}
        />
        {/* flukes — the two arms that catch the seabed */}
        <div
          style={{
            position: "absolute",
            bottom: 2 * u,
            width: 17 * u,
            height: 8 * u,
            borderBottom: `${stroke}px solid ${LIME}`,
            borderLeft: `${stroke}px solid ${LIME}`,
            borderRight: `${stroke}px solid ${LIME}`,
            borderBottomLeftRadius: 9 * u,
            borderBottomRightRadius: 9 * u,
          }}
        />
      </div>
    </div>
  );
}

export const size = { width: BASE_SIZE, height: BASE_SIZE };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<MatchlightMark size={size.width} />, {
    ...size,
  });
}
