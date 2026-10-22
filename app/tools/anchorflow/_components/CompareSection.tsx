import { Check } from "lucide-react";
import { COMPARISON } from "@/lib/site";

/**
 * How Anchorflow compares — against CATEGORIES, never named products. On wide
 * screens it is one table; on phones each criterion folds into a <details> so
 * the page stays short.
 */
export function CompareSection() {
  const [, ...others] = COMPARISON.columns;
  return (
    <section id="compare" aria-labelledby="compare-title" className="mx-auto w-full max-w-[1400px] px-4 py-16 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <h2 id="compare-title" className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
          Nothing to install, nothing to grant
        </h2>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
          Other ways to pin and audit actions are good at what they do. Anchorflow is the one that needs no install, no
          account and no access to your repository, and shows its working for every pin.
        </p>
      </div>

      {/* Wide: one table */}
      <div className="mt-8 hidden overflow-hidden rounded border border-line-strong bg-sheet md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="w-[22%] px-4 py-3 text-[13px] font-semibold text-ink-3">
                <span className="sr-only">Criterion</span>
              </th>
              {COMPARISON.columns.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  className={i === 0 ? "bg-seal/10 px-4 py-3 text-[15px] font-extrabold text-seal" : "px-4 py-3 text-[13px] font-semibold text-ink-2"}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {COMPARISON.rows.map((row) => (
              <tr key={row.criterion} className="align-top">
                <th scope="row" className="px-4 py-3 font-semibold text-ink">
                  {row.criterion}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={i} className={i === 0 ? "bg-seal/10 px-4 py-3 font-semibold text-ink" : "px-4 py-3 text-ink-2"}>
                    {i === 0 && row.win ? <Check className="mr-1.5 inline h-4 w-4 align-[-3px] text-seal" aria-hidden="true" /> : null}
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one fold per criterion */}
      <div className="mt-6 divide-y divide-line border-y border-line md:hidden">
        {COMPARISON.rows.map((row) => (
          <details key={row.criterion} className="group py-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <span>
                <span className="block font-semibold text-ink">{row.criterion}</span>
                <span className="mt-0.5 block text-sm text-seal">Anchorflow: {row.cells[0]}</span>
              </span>
              <span aria-hidden="true" className="mt-0.5 text-ink-3 transition-transform duration-150 group-open:rotate-45">+</span>
            </summary>
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-1 text-sm">
              {others.map((c, i) => (
                <div key={c.id} className="contents">
                  <dt className="text-ink-3">{c.name}</dt>
                  <dd className="text-ink-2">{row.cells[i + 1]}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>

      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-2">{COMPARISON.note}</p>
    </section>
  );
}
