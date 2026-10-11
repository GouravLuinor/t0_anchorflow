"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
}

const DEFAULT_DURATION = 2000;
const MAX_VISIBLE = 5;

let toasts: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function toast(options: ToastOptions): number {
  const id = ++nextId;
  toasts = [...toasts, { ...options, id }].slice(-MAX_VISIBLE);
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), options.duration ?? DEFAULT_DURATION);
  }
  return id;
}

export function dismissToast(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

function useToasts(): ToastItem[] {
  const [items, setItems] = React.useState<ToastItem[]>(toasts);
  React.useEffect(() => {
    const sync = () => setItems(toasts);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return items;
}

const variantStyles = {
  default: "border-surface-border bg-surface-default text-zinc-100",
  destructive:
    "border-brand-rose/40 bg-brand-rose/10 text-brand-rose hover:border-brand-rose/60",
} as const;

function Toaster() {
  const items = useToasts();
  const [mounted, setMounted] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col-reverse gap-2"
    >
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
    </div>,
    document.body
  );
}

export { Toaster };
