import { Check } from "lucide-react";
import { SITE, SITE_URL } from "@/lib/site";
import { CompareSection } from "./_components/CompareSection";
import { FaqSection } from "./_components/FaqSection";
import { GuideSection } from "./_components/GuideSection";
import { SiteFooter } from "./_components/SiteFooter";
import { SiteHeader } from "./_components/SiteHeader";
import { Workstation } from "./_components/Workstation";

const PROMISES = ["Never uploaded", "No account", "Free"] as const;

function jsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Anchorflow",
      url: `${SITE_URL}/tools/anchorflow`,
      description: SITE.description,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any (runs in the browser)",
      browserRequirements: "Requires JavaScript and Web Workers",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Pin GitHub Actions to full commit SHAs",
        "GITHUB_TOKEN permission audit per job",
        "Template-injection detection in run, with and if",
        "pull_request_target and persist-credentials checks",
        "Red/green diff of the pinned uses: lines",
        "Per-pin receipt with a git ls-remote check",
      ],
      creator: { "@type": "Organization", name: "Nor AI", url: "https://norai.tech" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: SITE.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: { "@type": "Answer", text: faq.a },
      })),
    },
  ];
}

export default function ToolPage() {
  return (
    <>
      <a
        href="#workstation"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
      >
        Skip to the workflow
      </a>

      <SiteHeader />

      <main className="w-full overflow-x-hidden">
        <section aria-labelledby="page-title" className="mx-auto w-full max-w-[1400px] px-4 pb-6 pt-8 sm:px-6 md:pt-10 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1
                id="page-title"
                className="text-[32px] font-extrabold leading-[1.06] tracking-[-0.025em] text-ink sm:text-[42px] lg:text-[48px]"
              >
                Pin GitHub Actions to commit SHAs, in your browser
              </h1>
              <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
                Paste a workflow. Get it back with every action pinned, every token grant audited and a receipt for each
                pin. The file never leaves this tab.
              </p>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-semibold text-ink-2 lg:pb-1.5">
              {PROMISES.map((p) => (
                <li key={p} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-seal" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6 lg:px-8">
          <Workstation />
        </div>

        <CompareSection />
        <GuideSection />
        <FaqSection />
      </main>

      <SiteFooter />

      <script
        type="application/ld+json"
        // Static, same-origin content from lib/site.ts — no user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
      />
    </>
  );
}
