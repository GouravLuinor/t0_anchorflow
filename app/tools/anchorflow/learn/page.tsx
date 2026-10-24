import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { LEARN_TOPICS } from "@/lib/learn";
import { SiteFooter } from "../_components/SiteFooter";
import { SiteHeader } from "../_components/SiteHeader";

export const metadata: Metadata = {
  title: "GitHub Actions hardening guides",
  description:
    "Six short guides to the habits that keep GitHub Actions workflows safe: SHA pinning, least-privilege tokens, template injection, pull_request_target, persist-credentials and verifying pins.",
  alternates: { canonical: "/tools/anchorflow/learn" },
};

export default function LearnIndex() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="max-w-3xl text-[32px] font-extrabold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
          GitHub Actions hardening guides
        </h1>
        <p className="mt-3 max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
          The six habits Anchorflow checks, each with the risk, the before and after, and how to verify it yourself.
          Published by{" "}
          <a href="https://norai.tech" className="font-semibold text-ink underline hover:text-seal">
            Nor AI
          </a>
          .
        </p>
        <ul className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
          {LEARN_TOPICS.map((t) => (
            <li key={t.slug}>
              <Link href={`/tools/anchorflow/learn/${t.slug}`} className="group flex items-start justify-between gap-4 py-4">
                <span>
                  <span className="block text-[18px] font-bold text-ink group-hover:text-seal">{t.title}</span>
                  <span className="mt-1 block max-w-prose text-[15px] leading-relaxed text-ink-2">{t.description}</span>
                </span>
                <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-ink-3 group-hover:text-seal" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8">
          <a href="/tools/anchorflow#workstation" className="font-semibold text-seal underline">
            Check a workflow now
          </a>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
