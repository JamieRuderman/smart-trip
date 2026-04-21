import { useLocation, useNavigate } from "react-router-dom";
import { GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";

export function MapDiagramPreviewCard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { data } = useVehiclePositions();
  useTripUpdates();

  const activeCount = data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <SectionCard className="overflow-hidden bg-smart-train-green/5 hover:bg-smart-train-green/10 transition-colors md:border-smart-train-green/30">
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: "/map-diagram", search: location.search })
        }
        className="w-full px-5 py-4 md:px-6 flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <GitCommitVertical className="h-5 w-5 text-smart-train-green flex-shrink-0" />
          <div>
            <div className="font-semibold text-sm text-smart-train-green">
              {t("mapDiagram.previewTitle")}
            </div>
            <div className="text-xs text-smart-train-green/70">
              {t("mapDiagram.previewSubtitle")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-smart-train-green text-white rounded-full px-2.5 py-0.5 whitespace-nowrap">
            {t("mapDiagram.trainsCount", { count: activeCount })}
          </span>
          <span className="text-smart-train-green text-lg">→</span>
        </div>
      </button>
    </SectionCard>
  );
}
