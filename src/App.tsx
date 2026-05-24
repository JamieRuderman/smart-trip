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
import { rehydrateWebReminders } from "@/lib/departureReminder";
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

  // Re-arm any persisted departure reminders after a page reload (web only;
  // native notifications survive launches on their own).
  useEffect(() => {
    rehydrateWebReminders();
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
