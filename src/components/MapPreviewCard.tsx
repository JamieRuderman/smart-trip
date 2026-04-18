import { useLocation, useNavigate } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";

export function MapPreviewCard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useVehiclePositions();
  // Pre-warm the trip updates query so the map page has cached delay/cancel
  // data the moment it mounts (otherwise markers appear after the first fetch).
  useTripUpdates();

  const activeCount =
    data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <SectionCard className="overflow-hidden bg-smart-train-green/5 hover:bg-smart-train-green/10 transition-colors md:border-smart-train-green/30">
      <button
        type="button"
        onClick={() => navigate({ pathname: "/map", search: location.search })}
        className="w-full px-5 py-4 md:px-6 flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <MapIcon className="h-5 w-5 text-smart-train-green flex-shrink-0" />
          <div>
            <div className="font-semibold text-sm text-smart-train-green">
              Live Train Map
            </div>
            <div className="text-xs text-smart-train-green/70">
              See all trains in real time
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-smart-train-green text-white rounded-full px-2.5 py-0.5">
            {activeCount} active
          </span>
          <span className="text-smart-train-green text-lg">→</span>
        </div>
      </button>
    </SectionCard>
  );
}
