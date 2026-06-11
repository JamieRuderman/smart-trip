import { lazy, Suspense, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Analytics } from "@vercel/analytics/react";
import { Capacitor } from "@capacitor/core";
import NativeUiManager from "@/components/NativeUiManager";
import { useAppForegroundRefresh } from "@/hooks/useAppForegroundRefresh";
import { emitAppRefreshEvent } from "@/lib/refreshEvents";
import { bootFocusedTrip } from "@/lib/focusedTrip";
import { reconcileTripActivities } from "@/hooks/useFocusedTrip";
import { LiveActivitySync } from "@/components/LiveActivitySync";
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

const App = () => {
  const isNative = Capacitor.isNativePlatform();

  useAppForegroundRefresh(async () => {
    emitAppRefreshEvent();
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
              <ErrorBoundary>
                <StationSelectionProvider>
                  {/* App-level iOS Live Activity sync — must live where it
                      survives route changes and sheet closes, since the lock
                      screen tracks the focused train regardless of view. */}
                  <LiveActivitySync />
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
                {!isNative && <Analytics />}
              </ErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
