import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, GitCommitVertical, Hand, Map as MapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGoBack } from "@/hooks/useTripViewNavigation";

interface MapHeaderProps {
  /** The map this header sits on; its button switches to the other one. */
  view: "line" | "geo";
  /** Live train count. Omit/null for the loading shell so no stale "0 trains"
   *  flashes before the real data arrives. */
  trainsCount?: number | null;
  /** Tapping the train count, where the map can act on it (fit the trains). */
  onTrainsCountClick?: () => void;
}

/** The green bar across the top of both maps. */
export function MapHeader({ view, trainsCount = null, onTrainsCountClick }: MapHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const backToSchedule = useGoBack("/");

  const switchView = () =>
    navigate(
      { pathname: view === "line" ? "/map" : "/map-diagram", search: location.search },
      { replace: true },
    );

  const trainsLabel =
    trainsCount != null ? t("mapDiagram.trainsCount", { count: trainsCount }) : null;

  return (
    <header
      className="shrink-0 bg-smart-train-green px-3 pb-2 flex items-center gap-2"
      style={{ paddingTop: "calc(12px + var(--safe-area-top))" }}
    >
      <button
        type="button"
        onClick={backToSchedule}
        className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 text-white hover:bg-white/25"
        aria-label={t("mapDiagram.closeMap")}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-1.5 text-xs leading-tight text-white/90 flex-1 min-w-0">
        <Hand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">
          {t(view === "line" ? "mapDiagram.tapHint" : "mapDiagram.tapTrainHint")}
        </span>
      </div>
      {trainsLabel &&
        (onTrainsCountClick ? (
          <button
            type="button"
            onClick={onTrainsCountClick}
            className="mr-1 text-xs font-semibold text-white whitespace-nowrap rounded-md px-1 py-1 hover:bg-white/15"
          >
            {trainsLabel}
          </button>
        ) : (
          <span className="mr-2 text-xs font-semibold text-white whitespace-nowrap">
            {trainsLabel}
          </span>
        ))}
      <button
        type="button"
        onClick={switchView}
        className="flex items-center gap-1.5 h-10 px-3 rounded-xl bg-white/15 text-white text-sm font-medium hover:bg-white/25"
        aria-label={t(view === "line" ? "map.showGeoView" : "map.showLineView")}
      >
        {view === "line" ? (
          <MapIcon className="w-4 h-4" aria-hidden="true" />
        ) : (
          <GitCommitVertical className="w-4 h-4" aria-hidden="true" />
        )}
        {t(view === "line" ? "map.geoView" : "map.lineView")}
      </button>
    </header>
  );
}
