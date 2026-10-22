"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-sunk",
      "transition-[background-color,border-color] duration-150 ease-out-expo",
      "hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-seal data-[state=checked]:bg-seal",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3.5 w-3.5 rounded-full bg-ink-3 transition-transform duration-150 ease-out-expo",
        "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-seal data-[state=unchecked]:translate-x-[2px]"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export { Switch };
