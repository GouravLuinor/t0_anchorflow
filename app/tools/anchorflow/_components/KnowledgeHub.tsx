import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GUIDE_TABS } from "../_lib/guide";

export function KnowledgeHub() {
  return (
    <section
      id="guide"
      className="mx-auto w-full max-w-7xl px-4 py-16 md:px-6 lg:px-8 scroll-mt-20"
    >
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
          Harden a workflow in four moves
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          Pinning, least privilege, injection and receipts — the four habits that
          separate a supply-chain-safe Actions setup from one that works until it
          doesn&rsquo;t. Every snippet below runs as written.
        </p>
      </div>

      <Tabs defaultValue={GUIDE_TABS[0].id} className="mt-8 w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {GUIDE_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {GUIDE_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-base glass-edge">
              <div className="px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                  {tab.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {tab.blurb}
                </p>
              </div>
              <pre className="overflow-x-auto border-t border-surface-border bg-surface-subtle/40 px-4 py-4 font-mono text-xs leading-relaxed text-zinc-200 md:px-6">
                <code>{tab.code}</code>
              </pre>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
