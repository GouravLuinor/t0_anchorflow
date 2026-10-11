"use client";

import React from "react";
import { FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolStore } from "../_store/useToolStore";
import { MAX_INPUT_BYTES } from "../_lib/constants";

/**
 * The input half of the workstation: one real <textarea> for the workflow
 * source. It is a controlled React input wired to the persisted store, so a
 * paste commits through the same debounce tiers the worker honours.
 */
export function RawEditorPane() {
  const source = useToolStore((s) => s.source);
  const setSource = useToolStore((s) => s.setSource);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const lineCount = useToolStore((s) => s.metrics.lineCount);
  const characterCount = useToolStore((s) => s.metrics.characterCount);
  const byteCount = useToolStore((s) => s.metrics.byteCount);
  const truncated = useToolStore((s) => s.metrics.truncated);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    // ⌘↵ / ⌃↵ focuses the primary input (rAF-deferred so the page is settled).
    const onFocusRequest = () => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("anchorflow:focus-input", onFocusRequest);
    return () =>
      window.removeEventListener("anchorflow:focus-input", onFocusRequest);
  }, []);

  return (
    <div className="flex h-full min-h-[400px] flex-col overflow-hidden bg-surface-base/30 lg:min-h-0">
      {/* Pane header — functional measurement labels only (craft floor rule 1) */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-border bg-surface-subtle/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Workflow YAML
          </span>
        </div>
        {truncated && (
          <span className="font-mono text-[10px] text-brand-amber tabular-nums">
            trimmed to {Math.round(MAX_INPUT_BYTES / 1024)} KiB for analysis
          </span>
        )}
      </div>

      <div className="relative mx-4 mb-3 mt-3 flex-1 overflow-hidden rounded-lg border border-surface-border bg-surface-default transition-colors focus-within:border-brand-lime/50 focus-within:ring-2 focus-within:ring-brand-lime/30">
        {!source && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
            <FileCode2 className="mb-3 h-8 w-8 text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">
              Paste a <span className="font-mono">.github/workflows</span> file
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-400">
              Everything below the toolbar is computed in a Web Worker inside
              this tab. Nothing is uploaded.
            </p>
          </div>
        )}

        <textarea
          ref={textareaRef}
          id="tool-source-input"
          name="workflow-source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="Workflow YAML source"
          aria-invalid={Boolean(errorMessage)}
          spellCheck={false}
          autoComplete="off"
          placeholder=""
          className={cn(
            "absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed",
            "text-zinc-100 caret-brand-lime placeholder:text-zinc-500 focus:outline-none",
            errorMessage && "text-brand-rose"
          )}
        />
      </div>

      {/* Pane footer measurements */}
      <div className="flex items-center justify-between gap-3 border-t border-surface-border bg-surface-subtle/30 px-4 py-2 font-mono text-[11px] text-zinc-400">
        <div className="flex items-center gap-3">
          <span>
            <strong className="tabular-nums text-zinc-300">{lineCount}</strong>{" "}
            lines
          </span>
          <span aria-hidden="true">•</span>
          <span>
            <strong className="tabular-nums text-zinc-300">
              {characterCount}
            </strong>{" "}
            chars
          </span>
          <span aria-hidden="true">•</span>
          <span>
            <strong className="tabular-nums text-zinc-300">{byteCount}</strong>{" "}
            bytes
          </span>
        </div>
        <span className="text-zinc-500">mono · machine data only</span>
      </div>
    </div>
  );
}
