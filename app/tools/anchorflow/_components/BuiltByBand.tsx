import { ArrowRight } from "lucide-react";
import { COMPANY } from "@/lib/site";
import { NorAiMark } from "./NorAiMark";

/** "Built by Nor AI": who made this tool, and the honest next step for teams that need more than one file. */
export function BuiltByBand() {
  return (
    <section aria-labelledby="built-by-title" className="border-t border-line bg-sunk/50">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="max-w-2xl">
          <h2
            id="built-by-title"
            className="flex items-center gap-3 text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]"
          >
            <NorAiMark size={36} />
            Built by Nor AI
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
            Anchorflow is a free tool from {COMPANY.name}, an engineering studio in Ghazipur, Uttar Pradesh. We build
            custom AI, web and 3D software that runs in your own infrastructure, and you keep the code.
          </p>
          <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
            Need this across every repository, or inside your CI? You talk to the engineers who write the code.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={COMPANY.contactUrl}
            className="inline-flex h-11 items-center gap-2 rounded bg-seal px-5 text-sm font-semibold text-on-seal hover:bg-seal/90"
          >
            Talk to an engineer
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            href={COMPANY.aboutUrl}
            className="inline-flex h-11 items-center rounded border border-line-strong px-5 text-sm font-semibold text-ink hover:bg-sunk"
          >
            About Nor AI
          </a>
        </div>
      </div>
    </section>
  );
}
