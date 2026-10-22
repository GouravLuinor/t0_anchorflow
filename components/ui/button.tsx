import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one seal-green action · outline = secondary · ghost = quiet. */
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "default" | "icon";
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-seal text-on-seal border border-seal hover:bg-seal/90 active:bg-seal/80",
  outline:
    "border border-line-strong bg-sheet text-ink hover:border-ink-3 hover:bg-sunk active:bg-line/60",
  ghost: "border border-transparent text-ink-2 hover:bg-sunk hover:text-ink active:bg-line/60",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-[13px]",
  default: "h-10 px-4 text-sm",
  icon: "h-9 w-9",
};

/**
 * The one button. Five states: idle, hover (fill shift), active (deeper fill),
 * focus-visible (the global seal outline), disabled (half opacity, no pointer).
 * A loading state is the caller's label + spinner with `aria-busy`.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "outline", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded font-semibold",
        "transition-[background-color,border-color,color] duration-150 ease-out-expo",
        "disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button };
