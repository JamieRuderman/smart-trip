import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { computeRealtimeAgeLabel } from "@/lib/realtimeAgeLabel";
import { cn } from "@/lib/utils";

interface MapLiveDataChipProps {
  /** Latest realtime feed timestamp from `useMapTrains().lastUpdated`. */
  lastUpdated: Date | null;
  /** True when the 511 live feed is failing — shows "Live data unavailable". */
  isUpstreamDown?: boolean;
}

/**
 * Floating chip on the map showing how recent the live train data is.
 * Mirrors `ScheduleHeader`'s "X min ago / stale" wording so the same mental
 * model carries over to the map. Hidden until we have a feed timestamp — unless
 * the 511 feed is down, in which case it surfaces "Live data unavailable" so a
 * blank map reads as an upstream outage rather than "no trains running".
 */
export function MapLiveDataChip({
  lastUpdated,
  isUpstreamDown = false,
}: MapLiveDataChipProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!lastUpdated) return;
    const id = window.setInterval(() => setNow(new Date()), 30 * 1000);
    return () => window.clearInterval(id);
  }, [lastUpdated]);

  if (!lastUpdated && !isUpstreamDown) return null;
  const { text, isStale } = computeRealtimeAgeLabel(
    t,
    lastUpdated,
    now,
    isUpstreamDown,
  );

  return (
    <div
      className={cn(
        "absolute right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background/95 backdrop-blur-sm shadow-md border border-border text-xs font-medium",
        isStale ? "text-smart-gold border-smart-gold/40" : "text-muted-foreground",
      )}
      style={{ top: "calc(56px + var(--safe-area-top))" }}
      role={isStale ? "status" : undefined}
      aria-live={isStale ? "polite" : undefined}
    >
      {isStale && (
        <AlertTriangle
          className="h-3 w-3 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
      <span>{text}</span>
    </div>
  );
}
