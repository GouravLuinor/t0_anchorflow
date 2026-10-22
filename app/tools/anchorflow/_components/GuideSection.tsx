import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LEARN_TOPICS } from "@/lib/learn";
import { GUIDE_TABS } from "../_lib/guide";

/**
 * The method, as one before/after you can read in ten seconds, then the index
 * of the six guides. A list, not a grid of cards.
 */
export function GuideSection() {
  const pinning = GUIDE_TABS.find((t) => t.id === "pinning") ?? GUIDE_TABS[0];
  return (
    <section id="guide" aria-labelledby="guide-title" className="border-y border-line bg-sheet">
      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
        <div>
          <h2 id="guide-title" className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
            {pinning.title}
          </h2>
          <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-ink-2">{pinning.blurb}</p>
          <pre className="mt-5 overflow-x-auto rounded border border-line bg-sunk/70 px-4 py-3 font-mono text-[12px] leading-[1.75] text-ink">
            {pinning.code}
          </pre>
        </div>
        <nav aria-labelledby="guides-index">
          <h3 id="guides-index" className="text-sm font-bold text-ink">
            The six habits Anchorflow checks
          </h3>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {LEARN_TOPICS.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/tools/anchorflow/learn/${t.slug}`}
                  className="group flex items-start justify-between gap-4 py-3.5"
                >
                  <span>
                    <span className="block font-bold text-ink group-hover:text-seal">{t.title}</span>
                    <span className="mt-0.5 block max-w-prose text-sm leading-relaxed text-ink-2">{t.description}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-seal" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
