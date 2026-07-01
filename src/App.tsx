import { lazy, Suspense, useEffect } from "react";
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
import { ReminderDialogHost } from "@/components/ReminderDialogHost";
import { StationSelectionProvider } from "@/contexts/StationSelectionContext";
import "@/lib/i18n"; // Initialize i18n
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Map routes pull in mapbox-gl (~700 KB JS + CSS). Lazy-load so users who
// stay on the schedule view never pay that cost.
const Map = lazy(() => import("./pages/Map"));
const MapDiagram = lazy(() => import("./pages/MapDiagram"));

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
  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
      <StationSelectionProvider>
        {/* App-level iOS Live Activity sync — must live where it survives
            route changes and sheet closes, since the lock screen tracks the
            focused train regardless of view. */}
        <LiveActivitySync />
        {/* App-level reminder modal host — lives here (like LiveActivitySync)
            so "Take this train" can pop it from any surface and it survives
            the triggering sheet/route change. */}
        <ReminderDialogHost />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/map" element={<Map />} />
            <Route path="/map-diagram" element={<MapDiagram />} />
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
