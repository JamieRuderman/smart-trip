import type { ReactNode } from "react";

interface ShrinkingContainerProps {
  height: number; // current visible height
  maxHeight: number; // full height to reserve in layout
  children: ReactNode;
  className?: string;
}

export function ShrinkingContainer({
  height,
  maxHeight,
  children,
  className,
}: ShrinkingContainerProps) {
  const clampedHeight = Math.max(0, Math.min(height, maxHeight));

  return (
    <div
      className={className}
      style={{
        height: `${clampedHeight}px`,
        maxHeight: `${maxHeight}px`,
        overflow: "hidden",
        transition: "height 120ms ease-out",
        willChange: "height",
      }}
    >
      {children}
    </div>
  );
}
