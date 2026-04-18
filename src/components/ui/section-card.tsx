import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * SectionCard wraps Card with the standard page-section layout:
 * borderless on mobile, bordered on md+.
 *
 * Use this for all top-level page sections (schedule, fares, alerts, etc.)
 * so border/shadow treatment is consistent and maintained in one place.
 */
const SectionCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <Card
    ref={ref}
    className={cn(
      "border-0 shadow-none md:border max-w-4xl mx-auto w-full",
      className,
    )}
    {...props}
  />
));
SectionCard.displayName = "SectionCard";

export { SectionCard };
