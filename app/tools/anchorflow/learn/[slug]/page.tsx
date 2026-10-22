import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEARN_TOPICS, topicBySlug } from "@/lib/learn";
import { SITE_URL } from "@/lib/site";
import { Seal } from "../../_components/Seal";
import { SiteFooter } from "../../_components/SiteFooter";
import { SiteHeader } from "../../_components/SiteHeader";

export const dynamicParams = false;

export function generateStaticParams() {
  return LEARN_TOPICS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const topic = topicBySlug(slug);
  if (!topic) return {};
  const path = `/tools/anchorflow/learn/${topic.slug}`;
  return {
    title: topic.title,
    description: topic.description,
    alternates: { canonical: path },
    openGraph: { title: topic.title, description: topic.description, url: path, type: "article" },
  };
}

export default async function LearnTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = topicBySlug(slug);
  if (!topic) notFound();
  const others = LEARN_TOPICS.filter((t) => t.slug !== topic.slug);
  const url = `${SITE_URL}/tools/anchorflow/learn/${topic.slug}`;

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: topic.title,
      description: topic.description,
      url,
      author: { "@type": "Organization", name: "Nor AI", url: "https://norai.tech" },
      publisher: { "@type": "Organization", name: "Nor AI", url: "https://norai.tech" },
      about: "GitHub Actions security",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Anchorflow", item: `${SITE_URL}/tools/anchorflow` },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/tools/anchorflow/learn` },
        { "@type": "ListItem", position: 3, name: topic.label, item: url },
      ],
    },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-12 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8">
        <article className="min-w-0 max-w-[72ch]">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
            <a href="/tools/anchorflow" className="hover:text-seal">
              Anchorflow
            </a>{" "}
            /{" "}
            <Link href="/tools/anchorflow/learn" className="hover:text-seal">
              Guides
            </Link>
          </nav>
          <h1 className="mt-3 text-[30px] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">
            {topic.title}
          </h1>
          <p className="mt-4 text-[18px] leading-relaxed text-ink-2">{topic.intro}</p>

          {topic.sections.map((section) => (
            <section key={section.heading} className="mt-10">
              <h2 className="text-[22px] font-bold leading-snug tracking-[-0.01em] text-ink">{section.heading}</h2>
              {section.body.map((p, i) => (
                <p key={i} className="mt-3 text-[16px] leading-[1.7] text-ink-2">
                  {p}
                </p>
              ))}
              {section.code ? (
                <pre className="mt-4 overflow-x-auto rounded border border-line bg-sunk/70 px-4 py-3 font-mono text-[12px] leading-[1.75] text-ink">
                  {section.code}
                </pre>
              ) : null}
            </section>
          ))}

          <section className="mt-12 rounded border border-line-strong bg-sheet p-5">
            <h2 className="flex items-center gap-2.5 text-[18px] font-bold text-ink">
              <Seal seed={topic.slug} size={24} />
              What Anchorflow checks
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{topic.inAnchorflow}</p>
            <a
              href="/tools/anchorflow#workstation"
              className="mt-4 inline-flex h-10 items-center rounded bg-seal px-4 text-sm font-semibold text-on-seal hover:bg-seal/90"
            >
              Check your workflow
            </a>
          </section>
        </article>

        <aside aria-label="More guides" className="lg:pt-16">
          <h2 className="text-sm font-bold text-ink">More guides</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {others.map((t) => (
              <li key={t.slug}>
                <Link href={`/tools/anchorflow/learn/${t.slug}`} className="block py-3 text-[15px] font-semibold text-ink-2 hover:text-seal">
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </>
  );
}
