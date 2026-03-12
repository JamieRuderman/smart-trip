import { cn } from "@/lib/utils";

/**
 * Gutter-aligned row: fixed w-[5rem] left spacer + flexible right content.
 * Keeps metadata text in the same column as stop names in the timeline.
 */
export function GutterRow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="w-[5rem] shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}
