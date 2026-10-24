/** The family thread's mark: the Nor AI logo, served from /public (no network egress). */
export function NorAiMark({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 160px static asset, fixed size
    <img
      src="/nor-ai-mark.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    />
  );
}
