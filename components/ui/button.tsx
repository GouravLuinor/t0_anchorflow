import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "cyan" | "emerald" | "danger";
  size?: "sm" | "default" | "lg" | "icon";
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      isLoading = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-2 font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out-expo select-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97] motion-reduce:transition-none touch-manipulation";

    const variantStyles = {
      default:
        "bg-ink text-canvas border border-transparent shadow-sm hover:brightness-110",
      outline:
        "bg-surface-default text-zinc-300 border border-surface-border hover:bg-surface-elevated/60 hover:border-surface-borderHover hover:text-zinc-100",
      ghost:
        "bg-transparent text-zinc-400 hover:bg-surface-elevated/60 hover:text-zinc-100",
      cyan:
        "bg-surface-subtle text-zinc-300 border border-surface-border hover:bg-surface-elevated/60 hover:border-surface-borderHover hover:text-zinc-100",
      emerald:
        "bg-brand-lime/10 text-brand-lime border border-brand-lime/40 hover:bg-brand-lime/20",
      danger:
        "bg-brand-rose/10 text-brand-rose border border-brand-rose/40 hover:bg-brand-rose/20",
    };

    const sizeStyles = {
      sm: "h-8 px-3 text-xs",
      default: "h-9 px-4 text-sm",
      lg: "h-11 px-6 text-base",
      icon: "h-9 w-9 p-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {isLoading ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" aria-hidden="true" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
