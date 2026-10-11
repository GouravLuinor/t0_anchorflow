"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Light/dark control. A `mounted` gate keeps the pre-hydration render stable
 * (always the Moon icon) so the server and first client paint match; once
 * mounted, the icon reflects the resolved theme and toggles between the two.
 *
 * Five interaction states: idle · hover (border-surface-borderHover +
 * elevated surface) · active (scale-[0.97]) · focus-visible (brand-lime ring)
 * · disabled (pre-mount, opacity-50).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      aria-pressed={isDark}
      title="Toggle theme"
      disabled={!mounted}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        "border border-surface-border bg-surface-subtle text-zinc-400",
        "transition-[color,background-color,border-color,box-shadow,transform]",
        "duration-150 ease-out-expo motion-reduce:transition-none",
        "hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
