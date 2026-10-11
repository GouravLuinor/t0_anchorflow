"use client";

import { useEffect } from "react";
import { copyTextToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useToolStore } from "../_store/useToolStore";

/**
 * The required keyboard set (BAR §2.6):
 *   ⌘K / ⌃K   toggle the command palette
 *   ⌘P / ⌃P   insert the example workflow (Anchorflow's preset affordance)
 *   ⌘⇧C / ⌃⇧C copy the current diagnostic output
 *   ⌘↵ / ⌃↵   focus the primary input (rAF-deferred)
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      const {
        isCommandPaletteOpen,
        setCommandPaletteOpen,
        setSource,
      } = useToolStore.getState();

      const key = e.key.toLowerCase();

      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
        return;
      }

      if (key === "p" && !e.shiftKey) {
        e.preventDefault();
        // Preset affordance: re-seed the editor with the example workflow.
        import("../_lib/presets").then(({ DEFAULT_WORKFLOW }) => {
          setSource(DEFAULT_WORKFLOW);
          toast({ title: "Example workflow inserted" });
        });
        return;
      }

      if (key === "c" && e.shiftKey) {
        // The derived output is the pinned YAML; with no resolutions it is the
        // byte-identical source, so the copy is always meaningful.
        const rewritten = useToolStore.getState().report.rewrittenYaml;
        if (!rewritten) return;
        e.preventDefault();
        void copyTextToClipboard(rewritten).then((succeeded) => {
          if (succeeded) {
            toast({ title: "Diagnostic output copied", description: "⌘⇧C" });
          } else {
            toast({ title: "Copy failed", variant: "destructive" });
          }
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        window.dispatchEvent(new Event("anchorflow:focus-input"));
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
