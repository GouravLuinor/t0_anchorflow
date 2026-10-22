import { ImageResponse } from "next/og";
import { sealGeometry } from "./tools/anchorflow/_lib/seal";

// The brand rosette (the seal drawn from the seed "anchorflow") in seal green
// on the security-paper ground, so the tab icon is the same mark as the header.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const { curves, innerRadius, outerRadius } = sealGeometry("anchorflow");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#e6ece4", borderRadius: 4 }}>
        <svg width="32" height="32" viewBox="0 0 100 100">
          <g fill="none" stroke="#1f6b4f" strokeLinejoin="round">
            <circle cx="50" cy="50" r={outerRadius + 1.5} strokeWidth="5" />
            {curves.map((d, i) => (
              <path key={i} d={d} strokeWidth="4" />
            ))}
            <circle cx="50" cy="50" r={innerRadius} strokeWidth="5" />
          </g>
        </svg>
      </div>
    ),
    size
  );
}
