import { PillBadge } from "./PillBadge";
import type { TripState } from "@/lib/tripTheme";

interface TripStatusPillsProps {
  statusLabel: string | null;
  statusColor: TripState | null;
}

export function TripStatusPills({ statusLabel, statusColor }: TripStatusPillsProps) {
  if (!statusLabel || !statusColor) return null;
  return <PillBadge label={statusLabel} color={statusColor} />;
}
