"use client";

import React from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_INPUT_BYTES } from "../_lib/constants";
import { DEFAULT_WORKFLOW } from "../_lib/presets";
import { useToolStore } from "../_store/useToolStore";

/**
 * "Your workflow": one real <textarea> wired to the persisted store, so a
 * paste commits through the same debounce tiers the worker honours. Under it
 * sits the file's true size: the bytes the engine measured, plus the 256 KiB
 * trim notice when the dispatch cap applies (AC-13).
 */
export function WorkflowEditor() {
  const source = useToolStore((s) => s.source);
  const setSource = useToolStore((s) => s.setSource);
  const reset = useToolStore((s) => s.reset);
  const errorMessage = useToolStore((s) => s.errorMessage);
  const lineCount = useToolStore((s) => s.metrics.lineCount);
  const byteCount = useToolStore((s) => s.metrics.byteCount);
  const truncated = useToolStore((s) => s.metrics.truncated);
  const characterCount = useToolStore((s) => s.metrics.characterCount);
  const wordCount = useToolStore((s) => s.metrics.wordCount);
  const hasResult = useToolStore((s) => s.report.rewrittenYaml !== null);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    // ⌘↵ / ⌃↵ focuses the primary input (rAF-deferred so the page is settled).
    const onFocusRequest = () => requestAnimationFrame(() => textareaRef.current?.focus());
    window.addEventListener("anchorflow:focus-input", onFocusRequest);
    return () => window.removeEventListener("anchorflow:focus-input", onFocusRequest);
  }, []);

  const isExample = source === DEFAULT_WORKFLOW;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-bold text-ink">
          Your workflow
          {isExample ? <span className="font-medium text-ink-3"> · example</span> : null}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setSource(DEFAULT_WORKFLOW)} disabled={isExample}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Example
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} disabled={!source}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-sunk/60">
        {!source && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-start justify-start gap-1 p-4">
            <p className="text-sm font-semibold text-ink">
              Paste a <span className="font-mono text-[13px]">.github/workflows/*.yml</span> file
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-ink-2">
              It stays in this tab. Or press Example to see a workflow with every kind of problem.
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
          aria-describedby="workflow-meta"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          wrap="off"
          className={cn(
            "absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent px-4 py-3 font-mono text-[12px] leading-[1.75] text-ink",
            "caret-seal placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
          )}
        />
      </div>

      <p
        id="workflow-meta"
        // The full measurement set, for parity checks between the two engines.
        data-lines={lineCount}
        data-bytes={byteCount}
        data-characters={characterCount}
        data-words={wordCount}
        className="figures flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 font-mono text-[11px] text-ink-3"
      >
        {hasResult || source ? (
          <>
            <span>
              <span className="text-ink-2">{lineCount.toLocaleString("en-US")}</span> lines
            </span>
            <span>
              <span className="text-ink-2">{byteCount.toLocaleString("en-US")}</span> bytes
            </span>
          </>
        ) : (
          <span>empty</span>
        )}
        {truncated && (
          <span className="text-major">trimmed to {Math.round(MAX_INPUT_BYTES / 1024)} KiB for analysis</span>
        )}
      </p>
    </div>
  );
}
