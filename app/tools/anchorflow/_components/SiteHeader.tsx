import { Seal } from "./Seal";
import { NorAiMark } from "./NorAiMark";
import { ThemeToggle } from "./ThemeToggle";
import { SignInButton } from "./auth/SignInButton";

const NAV = [
  { href: "/tools/anchorflow#workstation", label: "Pin a workflow" },
  { href: "/tools/anchorflow#compare", label: "Compare" },
  { href: "/tools/anchorflow/learn", label: "Guides" },
  { href: "/tools/anchorflow#faq", label: "FAQ" },
];

/** The band header: rosette + wordmark, section nav, and the quiet controls. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-band">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <a href="/tools/anchorflow" className="flex items-center gap-2.5 rounded" aria-label="Anchorflow home">
          <Seal seed="anchorflow" size={26} />
          <span className="text-[17px] font-extrabold tracking-[-0.01em] text-ink">Anchorflow</span>
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded px-2.5 py-1.5 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-sunk hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <SignInButton />
          <a
            href="https://norai.tech"
            className="ml-1 hidden items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-sunk hover:text-ink sm:inline-flex"
          >
            <NorAiMark />
            Nor AI
          </a>
        </div>
      </div>
      <div className="guilloche-rule border-b border-line" aria-hidden="true" />
    </header>
  );
}
