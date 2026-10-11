import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-surface-subtle dark:bg-surface-elevated motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
