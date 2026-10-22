import { SITE } from "@/lib/site";

/**
 * FAQ accordion (native <details>, readable without JS). The FAQPage JSON-LD
 * is emitted by the page from the SAME array, so the two never drift.
 */
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto w-full max-w-[1400px] px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 id="faq-title" className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
            Questions engineers ask
          </h2>
          <p className="mt-3 max-w-sm text-[16px] leading-relaxed text-ink-2">
            Privacy, pinning, Dependabot, permissions, injection and rate limits.
          </p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {SITE.faqs.map((faq) => (
            <details key={faq.q} className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-[16px] font-bold text-ink hover:text-seal">
                {faq.q}
                <span aria-hidden="true" className="mt-0.5 font-normal text-ink-3 transition-transform duration-150 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-prose pb-5 text-[15px] leading-relaxed text-ink-2">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
