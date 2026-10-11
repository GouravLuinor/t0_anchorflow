import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

const PRODUCT_LINKS = [
  { href: "#workstation", label: "Workstation" },
  { href: "#matrix", label: "Why Anchorflow" },
  { href: "#guide", label: "Guide" },
  { href: "#faq", label: "FAQ" },
];

const NORAI_LINKS = [
  { href: "https://norai.tech", label: "norai.tech" },
  { href: "https://tokens.norai.tech", label: "TokenCraft" },
  { href: "https://schema.norai.tech", label: "SchemaCraft" },
];

export function StudioFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-8 border-t border-surface-border bg-canvas/40">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 md:px-6 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between md:gap-16">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck
                className="h-4 w-4 shrink-0 text-brand-lime"
                aria-hidden="true"
              />
              100% In-Browser Workstation
            </div>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              Every match, railroad diagram, and export snippet is computed in a
              Web Worker inside your tab. Zero data leaves your machine — no
              account, no upload, and no telemetry on your patterns.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:gap-14">
            <nav aria-labelledby="footer-product">
              <h2
                id="footer-product"
                className="text-[11px] uppercase tracking-wide text-zinc-500"
              >
                Product
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {PRODUCT_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="rounded-md text-sm text-zinc-400 transition-colors duration-150 ease-out-expo hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-labelledby="footer-norai">
              <h2
                id="footer-norai"
                className="text-[11px] uppercase tracking-wide text-zinc-500"
              >
                More from Nor AI
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {NORAI_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 rounded-md text-sm text-zinc-400 transition-colors duration-150 ease-out-expo hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
                    >
                      {link.label}
                      <ArrowUpRight
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-surface-border pt-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular-nums">© {year} Nor AI</p>
          <p>
            An independent developer workstation by{" "}
            <Link
              href="https://norai.tech"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded font-medium text-zinc-400 underline-offset-2 transition-colors duration-150 ease-out-expo hover:text-zinc-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70"
            >
              Nor AI
            </Link>
            .
          </p>
          <p className="font-mono">anchor.norai.tech</p>
        </div>
      </div>
    </footer>
  );
}
