import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  mono?: boolean;
  invalid?: boolean;
}

function Input({
  className,
  type = "text",
  mono = false,
  invalid = false,
  disabled,
  ...props
}: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cn(
        "flex h-9 w-full rounded-lg border bg-surface-default px-3 py-1 text-sm text-zinc-100 shadow-none transition-[border-color,box-shadow,transform] duration-150 ease-out-expo outline-none placeholder:text-zinc-500 select-none touch-manipulation",
        "border-surface-border hover:border-surface-borderHover hover:bg-surface-elevated/60 active:scale-[0.97]",
        "focus-visible:border-surface-borderHover focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-surface-border motion-reduce:transition-none",
        mono && "font-mono text-xs tracking-tight",
        invalid &&
          "border-brand-rose/40 hover:border-brand-rose/60 focus-visible:ring-brand-rose/30",
        className
      )}
      {...props}
    />
  );
}

export { Input };
