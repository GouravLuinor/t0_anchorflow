import { ImageResponse } from "next/og";
import { sealGeometry } from "./tools/anchorflow/_lib/seal";

// Social card: the headline beside a pinned uses: line and its seal, drawn
// from a real commit SHA so the card shows the mechanism, not a mood.
export const alt = "Anchorflow: pin GitHub Actions to commit SHAs, in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SHA = "11bd71901bbe5b1630ceea73d27597364c9af683";

export default function OpengraphImage() {
  const seal = sealGeometry(SHA);
  const brand = sealGeometry("anchorflow");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#eef2ec",
          color: "#10231c",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 800 }}>
          <svg width="48" height="48" viewBox="0 0 100 100">
            <g fill="none" stroke="#1f6b4f">
              <circle cx="50" cy="50" r={brand.outerRadius + 1.5} strokeWidth="3" />
              {brand.curves.map((d, i) => (
                <path key={i} d={d} strokeWidth="2.2" />
              ))}
              <circle cx="50" cy="50" r={brand.innerRadius} strokeWidth="2.6" />
            </g>
          </svg>
          Anchorflow
        </div>
        <div style={{ display: "flex", marginTop: 44, fontSize: 70, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
          Pin GitHub Actions to commit SHAs, in your browser
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginTop: "auto",
            background: "#fbfcfa",
            border: "2px solid #9fb2a3",
            borderRadius: 4,
            padding: "22px 28px",
          }}
        >
          <svg width="92" height="92" viewBox="0 0 100 100">
            <g fill="none" stroke="#1f6b4f">
              <circle cx="50" cy="50" r={seal.outerRadius + 1.5} strokeWidth="1.6" />
              {seal.curves.map((d, i) => (
                <path key={i} d={d} strokeWidth="1.1" />
              ))}
              <circle cx="50" cy="50" r={seal.innerRadius} strokeWidth="1.4" />
            </g>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", fontFamily: "monospace", fontSize: 26 }}>
              uses: actions/checkout@{SHA.slice(0, 20)}… # v4
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#3a5549" }}>
              Never uploaded · No account · Free · by Nor AI
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
