/** The family thread's mark: a small "N" plate linking to norai.tech. */
export function NorAiMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-5 w-5 shrink-0 place-items-center rounded bg-ink text-[11px] font-extrabold leading-none text-paper ${className}`}
    >
      N
    </span>
  );
}
