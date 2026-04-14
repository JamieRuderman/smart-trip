import { useNavigate } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";

export function MapPreviewCard() {
  const navigate = useNavigate();
  const { data } = useVehiclePositions();

  const activeCount =
    data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <button
      onClick={() => navigate("/map")}
      className="w-full rounded-xl border border-smart-train-green/30 bg-smart-train-green/5 hover:bg-smart-train-green/10 transition-colors p-4 flex items-center justify-between gap-3 text-left"
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
  );
}
