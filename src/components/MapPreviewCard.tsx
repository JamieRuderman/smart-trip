import { useLocation, useNavigate } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";

export function MapPreviewCard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { data } = useVehiclePositions();
  // Pre-warm the trip updates query so the map page has cached delay/cancel
  // data the moment it mounts (otherwise markers appear after the first fetch).
  useTripUpdates();

  const activeCount =
    data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <SectionCard className="overflow-hidden bg-muted/40 hover:bg-muted/60 transition-colors md:border-border">
      <button
        type="button"
        onClick={() => navigate({ pathname: "/map", search: location.search })}
        className="w-full px-5 py-4 md:px-6 flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <MapIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold text-sm text-foreground">
              {t("map.previewTitle")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("map.previewSubtitle")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-muted-foreground text-background rounded-full px-2.5 py-0.5 whitespace-nowrap">
            {t("mapDiagram.trainsCount", { count: activeCount })}
          </span>
          <span className="text-muted-foreground text-lg">→</span>
        </div>
      </button>
    </SectionCard>
  );
}
