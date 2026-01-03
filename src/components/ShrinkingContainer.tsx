import type { ReactNode } from "react";

interface ShrinkingContainerProps {
  heightVar: string; // CSS variable containing current height
  maxHeight: number; // full height to reserve in layout
  children: ReactNode;
  className?: string;
}

export function ShrinkingContainer({
  heightVar,
  maxHeight,
  children,
  className,
}: ShrinkingContainerProps) {
  return (
    <div
      className={className}
      style={{
        height: `var(${heightVar}, ${maxHeight}px)`,
        maxHeight: `${maxHeight}px`,
        overflow: "hidden",
        willChange: "height",
      }}
    >
      {children}
    </div>
  );
}
