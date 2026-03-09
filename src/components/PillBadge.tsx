import { cn } from "@/lib/utils";

export function PillBadge({
  label,
  color = "green",
  className,
}: {
  label: string;
  color?: "green" | "gold" | "neutral" | "destructive";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap border",
        color === "green" && "bg-primary text-primary-foreground border-transparent",
        color === "gold" && "bg-smart-gold text-white border-transparent",
        color === "neutral" && "bg-foreground text-background border-transparent",
        color === "destructive" && "bg-destructive text-white border-transparent",
        className,
      )}
    >
      {label}
    </span>
  );
}
