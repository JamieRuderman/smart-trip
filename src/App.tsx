import { Suspense, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import NativeUiManager from "@/components/NativeUiManager";
import { useAppForegroundRefresh } from "@/hooks/useAppForegroundRefresh";
import { emitAppRefreshEvent } from "@/lib/refreshEvents";
import { bootFocusedTrip, FOCUSED_TRIP_CHANGED_EVENT } from "@/lib/focusedTrip";
import { reconcileTripActivities } from "@/lib/liveActivityController";
import { LiveActivitySync } from "@/components/LiveActivitySync";
import { FocusedTripAutoClear } from "@/components/FocusedTripAutoClear";
import { ReminderDialogHost } from "@/components/ReminderDialogHost";
import { StationsUpdatedHost } from "@/components/StationsUpdatedNotice";
import { ReminderDriftSync } from "@/components/ReminderDriftSync";
import { MapDiagramFrame } from "@/components/MapDiagramFrame";
import { StationSelectionProvider } from "@/contexts/StationSelectionContext";
import "@/lib/i18n"; // Initialize i18n
import { TRIP_VIEW_PATH } from "@/lib/tripView";
import Index from "./pages/Index";
import MyTrip from "./pages/MyTrip";
import NotFound from "./pages/NotFound";
// Map routes are code-split (the /map route pulls in mapbox-gl, ~1.7 MB) so
// schedule-only users never pay that cost. The home screen preloads these
// chunks while idle — see lazyPages / MapDiagramPreviewCard.
import { Map, MapDiagram } from "./pages/lazyPages";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** The routed subtree, wrapped in an ErrorBoundary that resets on navigation —
 *  so a render error tied to one route (e.g. a corrupt persisted selection)
 *  clears when the user navigates away, instead of stranding the whole app on
 *  the fallback. Lives inside BrowserRouter so it can read `useLocation`. */
const RoutedApp = () => {
  const location = useLocation();

  // The prerendered SEO sitelinks footer (#seo-sitelinks, injected into
  // dist/index.html by scripts/seo/prerender.ts and living OUTSIDE #root, so
  // React can't unmount it) belongs to the homepage. On the full-bleed map
  // routes and the My Trip view it just dangles below the page. Toggle a body
  // class the footer's own scoped <style> keys off — crawlers fetch the
  // homepage HTML and never navigate, so their crawl path into the
  // station/route pages is untouched. (Other paths — the 404, the SPA fallback
  // for /es/ — keep the links as a way into the site.)
  useEffect(() => {
    const onAppOnlyRoute =
      location.pathname.startsWith("/map") ||
      location.pathname === TRIP_VIEW_PATH;
    document.body.classList.toggle("seo-sitelinks-hidden", onAppOnlyRoute);
  }, [location.pathname]);

  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
      <StationSelectionProvider>
        {/* App-level iOS Live Activity sync — must live where it survives
            route changes and sheet closes, since the lock screen tracks the
            focused train regardless of view. */}
        <LiveActivitySync />
        {/* Platform-independent auto-clear of the focused trip a short grace
            after (live-aware) arrival — the My Trip view exists on
            web/Android too, where LiveActivitySync doesn't run. */}
        <FocusedTripAutoClear />
        {/* App-level reminder modal host — lives here (like LiveActivitySync)
            so "Take this train" can pop it from any surface and it survives
            the triggering sheet/route change. */}
        <ReminderDialogHost />
        {/* Likewise for the location fix's "stations updated" notice. */}
        <StationsUpdatedHost />
        {/* Keeps an armed leave-reminder's fire time tracking live departure
            drift on every platform — the in-sheet reschedule only runs while
            the trip detail sheet is open. */}
        <ReminderDriftSync />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* Full-page view of the focused ("Take this train") trip. In the
                main bundle (no heavy deps) so "Take this train" and a launch
                into it render without a loading flash. */}
            <Route path={TRIP_VIEW_PATH} element={<MyTrip />} />
            <Route path="/map" element={<Map />} />
            {/* Per-route fallback: the line-diagram frame (green bar + blank
                container) renders instantly while the code chunk loads, so the
                page shell appears the moment you navigate. */}
            <Route
              path="/map-diagram"
              element={
                <Suspense fallback={<MapDiagramFrame />}>
                  <MapDiagram />
                </Suspense>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </StationSelectionProvider>
    </ErrorBoundary>
  );
};

const App = () => {
  useAppForegroundRefresh(async () => {
    emitAppRefreshEvent();
    // Re-read the focused trip so a reminder that fired while we were away
    // clears immediately — its OS alarm has no JS callback — and reconcile the
    // Live Activity (end orphans; start it if we've just entered the show
    // window, or recover one that was dismissed).
    window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
    void reconcileTripActivities();
    await queryClient.refetchQueries({ type: "active" });
  });

  // Run boot sequence: migrate legacy reminders and re-arm the web timer for
  // any surviving reminder (native notifications survive launches on their own).
  // Then end any orphaned iOS Live Activity — the OS keeps activities alive
  // across launches, so one whose trip was auto-cleared (arrival passed,
  // timetable changed) must be dismissed here. Instant no-op off-iOS.
  useEffect(() => {
    bootFocusedTrip();
    void reconcileTripActivities();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="smart-train-theme">
          <NativeUiManager />
          <TooltipProvider>
            <BrowserRouter>
              <RoutedApp />
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
