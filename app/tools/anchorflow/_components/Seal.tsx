import { memo } from "react";
import { cn } from "@/lib/utils";
import { sealGeometry } from "../_lib/seal";

interface SealProps {
  /** The commit SHA (or any seed) the rosette is drawn from. */
  seed: string;
  size?: number;
  /** Draw the strokes in once on mount — the moment a pin lands. */
  drawIn?: boolean;
  className?: string;
  /** Accessible name; omit for a purely decorative seal. */
  title?: string;
}

/**
 * The guilloché seal: a rosette generated from a commit SHA, printed in seal
 * ink. Same SHA, same seal — so two pins can be told apart at a glance.
 */
export const Seal = memo(function Seal({
  seed,
  size = 28,
  drawIn = false,
  className,
  title,
}: SealProps) {
  const { curves, innerRadius, outerRadius } = sealGeometry(seed);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 text-seal", drawIn && "seal-draw", className)}
    >
      <g fill="none" stroke="currentColor" strokeLinejoin="round">
        <circle cx="50" cy="50" r={outerRadius + 1.5} strokeWidth={size < 40 ? 3 : 1.4} pathLength={1} />
        {curves.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            strokeWidth={size < 40 ? 2.2 : 0.9}
            strokeOpacity={i === 0 ? 1 : 0.78}
            style={drawIn ? { animationDelay: `${i * 60}ms` } : undefined}
          />
        ))}
        <circle cx="50" cy="50" r={innerRadius} strokeWidth={size < 40 ? 2.6 : 1.2} pathLength={1} />
      </g>
    </svg>
  );
});

/** The open seal: a dashed ring where a pin has not landed yet. */
export function OpenSeal({ size = 28, tone = "moving" }: { size?: number; tone?: "moving" | "muted" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("shrink-0", tone === "moving" ? "text-moving" : "text-ink-3")}
    >
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeDasharray={tone === "moving" ? "10 9" : "3 9"}
        strokeLinecap="round"
      />
    </svg>
  );
}
