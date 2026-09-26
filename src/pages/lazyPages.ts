import { lazy } from "react";

/**
 * Dynamic-import thunks for the code-split map routes, exported so the home
 * screen can PRELOAD a route's chunk before the user navigates to it.
 *
 * Without a preload, the first navigation flashes the blank
 * `<Suspense fallback={null}>` while the chunk is fetched over the network —
 * reading like a full reload even though it's an in-app route change. Warming
 * the import while the home screen is idle (see MapDiagramPreviewCard) means
 * the module is already resolved when the route mounts, so React.lazy renders
 * it without ever showing the fallback. The browser dedupes the dynamic import
 * by resolved URL, so the warm-up and the real render share a single fetch.
 */
export const importMapDiagram = () => import("./MapDiagram");
export const importMap = () => import("./Map");

export const MapDiagram = lazy(importMapDiagram);
export const Map = lazy(importMap);
