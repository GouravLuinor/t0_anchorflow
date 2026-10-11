import { Check, Minus } from "lucide-react";

type Cell = boolean | string;

interface Row {
  capability: string;
  anchorflow: Cell;
  actionlint: Cell;
  zizmor: Cell;
  stepsecurity: Cell;
}

const ROWS: Row[] = [
  {
    capability: "Runs in your browser",
    anchorflow: true,
    actionlint: false,
    zizmor: false,
    stepsecurity: true,
  },
  {
    capability: "Resolves a tag to a commit SHA",
    anchorflow: true,
    actionlint: false,
    zizmor: false,
    stepsecurity: true,
  },
  {
    capability: "Workflow text stays local",
    anchorflow: true,
    actionlint: true,
    zizmor: true,
    stepsecurity: false,
  },
  {
    capability: "Copy-ready pinned YAML",
    anchorflow: true,
    actionlint: false,
    zizmor: false,
    stepsecurity: false,
  },
  {
    capability: "Red/green diff of what changed",
    anchorflow: true,
    actionlint: false,
    zizmor: false,
    stepsecurity: false,
  },
  {
    capability: "Reproduce receipt per pin",
    anchorflow: "ls-remote line + endpoint",
    actionlint: "n/a",
    zizmor: "n/a",
    stepsecurity: "External only",
  },
];

const BOOLEAN_LABELS: Record<string, { yes: string; no: string }> = {
  "Runs in your browser": { yes: "Yes — no install", no: "Binary / cloud" },
  "Resolves a tag to a commit SHA": { yes: "Yes, on demand", no: "Cannot" },
  "Workflow text stays local": { yes: "Never uploaded", no: "Uploaded" },
  "Copy-ready pinned YAML": { yes: "One paste", no: "Manual" },
  "Red/green diff of what changed": { yes: "Line-level", no: "None" },
};

function renderCell(
  cell: Cell,
  self: boolean,
  labels?: { yes: string; no: string }
) {
  const valueClass = self ? "font-medium text-zinc-100" : "text-zinc-400";
  if (cell === true)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Check className="h-4 w-4 shrink-0 text-brand-lime" aria-hidden="true" />
        <span className={valueClass}>{labels?.yes ?? "Yes"}</span>
      </span>
    );
  if (cell === false)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Minus className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <span className={valueClass}>{labels?.no ?? "No"}</span>
      </span>
    );
  return <span className={valueClass}>{cell}</span>;
}

export function CompetitorMatrix() {
  return (
    <section
      id="matrix"
      className="mx-auto w-full max-w-7xl px-4 py-16 md:px-6 lg:px-8 scroll-mt-20"
      aria-labelledby="matrix-title"
    >
      <div className="max-w-3xl">
        <h2
          id="matrix-title"
          className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl"
        >
          Why Anchorflow
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          The linters that came before it audit brilliantly and stop there: they
          cannot tell you which commit a tag points at, and they want your
          workflow in their cloud. Anchorflow is a browser-native workstation
          that resolves the pin, audits the token, and hands you the diff.
        </p>
      </div>

      <div className="mt-8 overflow-x-auto rounded-2xl border border-surface-border bg-surface-base glass-edge">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-subtle/30">
              <th
                scope="col"
                className="px-4 py-3.5 font-mono text-xs uppercase tracking-wide text-zinc-400"
              >
                Capability
              </th>
              <th
                scope="col"
                className="bg-brand-lime/[0.05] px-4 py-3.5 font-mono text-xs uppercase tracking-wide font-semibold text-brand-lime"
              >
                Anchorflow
              </th>
              <th
                scope="col"
                className="px-4 py-3.5 font-mono text-xs uppercase tracking-wide text-zinc-400"
              >
                actionlint
              </th>
              <th
                scope="col"
                className="px-4 py-3.5 font-mono text-xs uppercase tracking-wide text-zinc-400"
              >
                zizmor
              </th>
              <th
                scope="col"
                className="px-4 py-3.5 font-mono text-xs uppercase tracking-wide text-zinc-400"
              >
                StepSecurity
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.capability}
                className="border-b border-surface-border last:border-0 hover:bg-surface-subtle/20 transition-colors"
              >
                <th
                  scope="row"
                  className="px-4 py-3.5 text-left font-medium text-zinc-200"
                >
                  {row.capability}
                </th>
                <td className="bg-brand-lime/[0.05] px-4 py-3.5">
                  {renderCell(row.anchorflow, true, BOOLEAN_LABELS[row.capability])}
                </td>
                <td className="px-4 py-3.5">
                  {renderCell(row.actionlint, false, BOOLEAN_LABELS[row.capability])}
                </td>
                <td className="px-4 py-3.5">
                  {renderCell(row.zizmor, false, BOOLEAN_LABELS[row.capability])}
                </td>
                <td className="px-4 py-3.5">
                  {renderCell(row.stepsecurity, false, BOOLEAN_LABELS[row.capability])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
