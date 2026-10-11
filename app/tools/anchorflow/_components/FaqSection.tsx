"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { SITE } from "@/lib/site";

/**
 * FAQ accordion (native <details>/<summary>, no JS required to read) plus the
 * FAQPage JSON-LD derived from the SAME array — one source, zero drift
 * (BAR §2.4 · SPEC §9 AC-18).
 */
function buildFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: SITE.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };
}

export function FaqSection() {
  return (
    <section
      id="faq"
      className="mx-auto w-full max-w-4xl px-4 py-14 md:px-6 lg:px-8 scroll-mt-20"
      aria-labelledby="faq-title"
    >
      <div className="max-w-3xl">
        <h2
          id="faq-title"
          className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl"
        >
          Frequently answered questions
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Privacy, pinning mechanics, the permissions audit, injection detection,
          and what happens when GitHub rate-limits your browser.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {SITE.faqs.map((faq) => (
          <details
            key={faq.q}
            className="group rounded-xl border border-surface-border bg-surface-base transition-colors open:border-surface-borderHover [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-surface-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/40">
              <span className="text-left">{faq.q}</span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="border-t border-surface-border/40 px-4 pb-4 pt-3 text-xs leading-relaxed text-zinc-400 sm:text-sm">
              {faq.a}
            </div>
          </details>
        ))}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd()) }}
      />
    </section>
  );
}
