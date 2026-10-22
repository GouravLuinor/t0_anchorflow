import React from "react";
import { cn } from "@/lib/utils";

interface KeycapProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  size?: "xs" | "sm";
}

export function Keycap({ children, className, size = "sm", ...props }: KeycapProps) {
  return (
    <kbd
      className={cn(
        "inline-flex select-none items-center justify-center rounded border border-line-strong bg-sheet font-mono text-ink-2",
        size === "xs" ? "h-4 min-w-4 px-1 text-[9px]" : "h-5 min-w-5 px-1.5 text-[10px]",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
