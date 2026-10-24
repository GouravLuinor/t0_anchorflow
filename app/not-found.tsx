import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-mono text-xs text-zinc-500">404</p>
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        That route is not part of the workstation
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-zinc-400">
        Anchorflow is a single page: the workstation, the comparison, the guide
        and the FAQ all live under one route.
      </p>
      <Link
        href="/tools/anchorflow"
        className="inline-flex h-9 items-center justify-center rounded-lg border border-surface-border bg-surface-default px-4 text-sm font-medium text-zinc-200 transition-[background-color,border-color,color,transform] duration-150 ease-out-expo hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
      >
        Open the workstation
      </Link>
      <a href="https://norai.tech" className="text-sm text-zinc-400 underline hover:text-zinc-200">
        Anchorflow is a free tool by Nor AI
      </a>
    </div>
  );
}
