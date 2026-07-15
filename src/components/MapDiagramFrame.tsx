import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Hand } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MapDiagramFrameProps {
  /** Live train count for the header badge. Omit/null for the loading shell so
   *  no stale "0 trains" flashes before the real data arrives. */
  trainsCount?: number | null;
  /** Background-tap handler for the scroll container (clears train selection).
   *  Absent on the shell, which has nothing to deselect. */
  onBackground?: () => void;
  children?: ReactNode;
}

/**
 * The static frame of the line-diagram page — the green header + the scroll
 * container. Deliberately lives in the MAIN bundle (no heavy diagram/hook
 * imports) so it can render INSTANTLY as the lazy /map-diagram route's Suspense
 * fallback: the green top bar and blank page appear the moment you navigate,
 * while the code chunk loads. {@link MapDiagram} reuses the exact same frame,
 * so it stays pixel-stable across the fallback → mounted swap — only the
 * diagram fades into the container, making the load read as intentional.
 */
export function MapDiagramFrame({
  trainsCount = null,
  onBackground,
  children,
}: MapDiagramFrameProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const backToSchedule = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search });
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background flex flex-col">
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
        <div className="flex items-center gap-1.5 text-xs text-white/90 flex-1 min-w-0">
          <Hand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("mapDiagram.tapHint")}</span>
        </div>
        {trainsCount != null && (
          <span className="text-xs font-semibold bg-white/15 text-white rounded-full px-2.5 py-1 whitespace-nowrap">
            {t("mapDiagram.trainsCount", { count: trainsCount })}
          </span>
        )}
      </header>

      {/* Background tap clears the train selection; inner station/train clicks
          stopPropagation so they don't also clear it. */}
      <div className="flex-1 min-h-0 overflow-auto" onClick={onBackground}>
        {children}
      </div>
    </div>
  );
}
