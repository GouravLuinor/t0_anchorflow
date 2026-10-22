"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissToast, type ToastItem } from "./toast";

/**
 * The toast list, split out so it loads only when a toast first appears.
 * Entrance is a CSS fade/slide (tailwindcss-animate), zeroed under reduced
 * motion by the global kill-switch.
 */
export default function ToastStack({ items }: { items: readonly ToastItem[] }) {
  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          data-toast-variant={item.variant ?? "default"}
          className={cn(
            "pointer-events-auto flex w-full items-start gap-3 rounded border bg-sheet p-3 text-ink shadow-pop",
            "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
            item.variant === "destructive" ? "border-critical" : "border-line-strong"
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className={cn("text-sm font-semibold leading-tight", item.variant === "destructive" && "text-critical")}>
              {item.title}
            </p>
            {item.description ? (
              <p className="font-mono text-xs leading-relaxed text-ink-2">{item.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(item.id)}
            aria-label="Dismiss notification"
            className="ml-auto shrink-0 rounded p-1 text-ink-3 transition-colors duration-150 hover:bg-sunk hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </>
  );
}
