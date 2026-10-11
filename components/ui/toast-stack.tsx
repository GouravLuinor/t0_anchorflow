"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissToast, type ToastItem } from "./toast";

const variantStyles = {
  default: "border-surface-border bg-surface-default text-zinc-100",
  destructive:
    "border-brand-rose/40 bg-brand-rose/10 text-brand-rose hover:border-brand-rose/60",
} as const;

/**
 * The animated toast list. Deliberately its own module so the animation
 * runtime (framer-motion) is fetched the first time a toast actually appears
 * instead of riding in First Load JS — a copy-failure toast is rare, and the
 * default first paint ships with none.
 *
 * Presentation is byte-for-byte the original motion block: same spring, same
 * reduced-motion short-circuit, same exit, same markup and five-state button.
 */
export default function ToastStack({ items }: { items: readonly ToastItem[] }) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {items.map((item) => (
        <motion.div
          key={item.id}
          layout
          role="status"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 24, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 24 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 32 }
          }
          className={cn(
            "pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-3 shadow-elevated transition-colors duration-150 motion-reduce:transition-none",
            variantStyles[item.variant ?? "default"]
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium leading-none tracking-tight">
              {item.title}
            </p>
            {item.description ? (
              <p
                className={cn(
                  "font-mono text-xs leading-relaxed",
                  item.variant === "destructive"
                    ? "text-brand-rose/70"
                    : "text-zinc-400"
                )}
              >
                {item.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(item.id)}
            aria-label="Dismiss notification"
            className="ml-auto shrink-0 rounded-md p-1 text-zinc-500 opacity-70 transition-[opacity,background-color,transform] duration-150 ease-out-expo hover:bg-surface-elevated/60 hover:text-zinc-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:opacity-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
