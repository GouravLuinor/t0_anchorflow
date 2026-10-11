import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "emerald" | "cyan" | "violet" | "amber" | "rose" | "outline";
}

function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variantStyles = {
    default:
      "bg-surface-subtle text-zinc-300 border-surface-border",
    emerald:
      "bg-brand-lime/10 text-brand-lime border-brand-lime/40",
    cyan:
      "bg-surface-subtle text-zinc-300 border-surface-border",
    violet:
      "bg-brand-violet/10 text-brand-violet border-brand-violet/40",
    amber:
      "bg-brand-amber/10 text-brand-amber border-brand-amber/40",
    rose:
      "bg-brand-rose/10 text-brand-rose border-brand-rose/40",
    outline:
      "bg-transparent text-zinc-400 border-surface-border",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-medium border transition-colors",
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
