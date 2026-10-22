import Link from "next/link";
import { FAMILY_TOOLS } from "@/lib/site";
import { LEARN_TOPICS } from "@/lib/learn";
import { NorAiMark } from "./NorAiMark";
import { Seal } from "./Seal";

/** The family footer, printed in Anchorflow's own ink. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-band">
      <div className="guilloche-rule" aria-hidden="true" />
      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:px-8">
        <div>
          <p className="flex items-center gap-2.5 text-[17px] font-extrabold text-ink">
            <Seal seed="anchorflow" size={26} />
            Anchorflow
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-2">
            Pin and audit GitHub Actions workflows. Free, no account, and your workflow never leaves the browser.
          </p>
          <a href="https://norai.tech" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-seal">
            <NorAiMark />
            Built by Nor AI
          </a>
        </div>

        <nav aria-labelledby="footer-guides">
          <h2 id="footer-guides" className="text-sm font-bold text-ink">
            Guides
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:block md:space-y-2">
            {LEARN_TOPICS.map((t) => (
              <li key={t.slug}>
                <Link href={`/tools/anchorflow/learn/${t.slug}`} className="text-sm text-ink-2 hover:text-seal">
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-family">
          <h2 id="footer-family" className="text-sm font-bold text-ink">
            More free tools
          </h2>
          <ul className="mt-3 space-y-2">
            {FAMILY_TOOLS.map((t) => (
              <li key={t.id}>
                <a href={t.url} className="group text-sm">
                  <span className="font-semibold text-ink group-hover:text-seal">{t.name}</span>
                  <span className="text-ink-2"> · {t.line}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 border-t border-line px-4 py-5 text-[13px] text-ink-3 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} Nor AI</p>
        <p>Not affiliated with GitHub. GitHub Actions is a trademark of GitHub, Inc.</p>
      </div>
    </footer>
  );
}
