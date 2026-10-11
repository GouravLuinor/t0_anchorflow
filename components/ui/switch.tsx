"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * Radix switch carrying all five interaction states (idle / hover / active
 * scale / focus-visible accent ring / disabled opacity) on a 4px grid.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-surface-border bg-surface-subtle",
      "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out-expo motion-reduce:transition-none",
      "hover:border-surface-borderHover hover:bg-surface-elevated",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-brand-lime/40 data-[state=checked]:bg-brand-lime/20",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3.5 w-3.5 rounded-full bg-zinc-400 shadow-sm ring-0",
        "transition-transform duration-150 ease-out-expo motion-reduce:transition-none",
        "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-brand-lime",
        "data-[state=unchecked]:translate-x-[3px]"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export { Switch };
