"use client";

import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { SignInButton } from "./auth/SignInButton";

const NAV = [
  { href: "#workstation", label: "Workstation" },
  { href: "#matrix", label: "Why Anchorflow" },
  { href: "#guide", label: "Guide" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Anchorflow — home"
          className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-lg border border-surface-border bg-surface-elevated font-mono text-sm font-extrabold leading-none text-brand-lime glass-edge"
          >
            ⚓
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold tracking-tight text-zinc-100">
              Anchorflow
            </span>
            <span className="block truncate text-xs text-zinc-400">
              GitHub Actions workstation
            </span>
          </span>
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors duration-150 ease-out-expo hover:bg-surface-subtle hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <SignInButton />
        </div>
      </div>
    </header>
  );
}
