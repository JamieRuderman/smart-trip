import { cn } from "@/lib/utils";

export function PillBadge({
  label,
  color = "green",
  className,
}: {
  label: string;
  color?: "green" | "gold";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs text-white px-2 py-0.5 rounded-md font-medium whitespace-nowrap",
        color === "green" ? "bg-primary" : "bg-smart-gold",
        className,
      )}
    >
      {label}
    </span>
  );
}
