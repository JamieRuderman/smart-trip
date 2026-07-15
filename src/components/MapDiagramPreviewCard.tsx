import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { importMapDiagram } from "@/pages/lazyPages";

/** Fire-and-forget warm of the code-split map-diagram chunk (see lazyPages).
 *  Silently ignores a failed preload — the real navigation will refetch and
 *  surface any error through Suspense/the ErrorBoundary. */
function warmMapDiagram() {
  void importMapDiagram().catch(() => {});
}

export function MapDiagramPreviewCard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { data } = useVehiclePositions();
  useTripUpdates();

  // Preload the map-diagram chunk once the home screen is idle, so tapping the
  // card navigates instantly instead of flashing the blank Suspense fallback
  // during the first chunk fetch. In a useEffect so it never runs during the
  // SEO prerender (Node) — only in the browser.
  useEffect(() => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (ric) {
      const id = ric(warmMapDiagram);
      return () => {
        (window as unknown as { cancelIdleCallback?: (id: number) => void })
          .cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(warmMapDiagram, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const activeCount = data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <SectionCard className="overflow-hidden bg-smart-train-green/5 hover:bg-smart-train-green/10 transition-colors">
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: "/map-diagram", search: location.search })
        }
        // Backstop the idle preload: warm the chunk the moment the user shows
        // intent, covering a tap that lands before requestIdleCallback fired.
        onPointerEnter={warmMapDiagram}
        onFocus={warmMapDiagram}
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
