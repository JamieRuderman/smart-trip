import { PillBadge } from "./PillBadge";

interface TripStatusPillsProps {
  statusLabel: string | null;
  statusColor: "green" | "gold" | "destructive" | null;
}

export function TripStatusPills({ statusLabel, statusColor }: TripStatusPillsProps) {
  if (!statusLabel || !statusColor) return null;
  return <PillBadge label={statusLabel} color={statusColor} />;
}
