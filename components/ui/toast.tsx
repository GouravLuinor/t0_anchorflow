"use client";

import * as React from "react";
import { createPortal } from "react-dom";

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

/**
 * The animation runtime is a separate module loaded on demand — a copy-failure
 * toast is a rare event, so paying for its runtime on every first paint was
 * pure waste. `ToastStack` is therefore split out and mounted lazily, and only
 * once something is actually on screen. The live region itself stays mounted
 * eagerly and empty, exactly as before, so screen-reader semantics are
 * unchanged.
 */
const ToastStack = React.lazy(() => import("./toast-stack"));

function Toaster() {
  const items = useToasts();
  const [mounted, setMounted] = React.useState(false);
  // Latch: once a toast has appeared the stack stays mounted so its exit
  // animation can finish when the list empties.
  const [engaged, setEngaged] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (items.length > 0) setEngaged(true);
  }, [items.length]);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col-reverse gap-2"
    >
      {engaged ? (
        <React.Suspense fallback={null}>
          <ToastStack items={items} />
        </React.Suspense>
      ) : null}
    </div>,
    document.body
  );
}

export { Toaster };
