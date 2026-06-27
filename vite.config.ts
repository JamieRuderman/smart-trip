import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (not just VITE_* prefixed) so we can read USE_SAMPLE_DATA
  const env = loadEnv(mode, process.cwd(), "");
  const useSampleData = env.USE_SAMPLE_DATA === "true";
  const devApiProxyTarget =
    env.DEV_API_PROXY_TARGET?.trim() || "https://smarttraintrip.com";

  return {
    server: {
      host: "::",
      port: 3210,
      // When not using sample data, proxy /api to the production Worker by
      // default (override DEV_API_PROXY_TARGET to point at a local `wrangler
      // dev`). changeOrigin so the Host header matches the custom-domain route.
      proxy:
        mode === "development" && !useSampleData
          ? {
              "/api": {
                target: devApiProxyTarget,
                changeOrigin: true,
                secure: true,
              },
            }
          : undefined,
    },
    plugins: [
      react(),
      // When USE_SAMPLE_DATA=true, intercept API routes and serve local JSON files
      mode === "development" &&
        useSampleData && {
          name: "sample-api-mock",
          configureServer(server: ViteDevServer) {
            const serveSample = (samplePath: string) =>
              (req: IncomingMessage, res: ServerResponse) => {
                void req;
                const data = readFileSync(
                  resolve(__dirname, samplePath),
                  "utf-8"
                );
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(data);
              };
            server.middlewares.use(
              "/api/gtfsrt/vehiclepositions",
              serveSample("data/511/realtime-samples/vehiclepositions.json")
            );
            server.middlewares.use(
              "/api/gtfsrt/tripupdates",
              serveSample("data/511/realtime-samples/tripupdates.json")
            );
            server.middlewares.use(
              "/api/gtfsrt/alerts",
              serveSample("data/511/realtime-samples/alert.json")
            );
          },
        },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Keep mapbox-gl in its own chunk so the lazy-loaded Map route can
          // pull it in on demand without dragging it into the initial bundle.
          manualChunks: {
            "mapbox-gl": ["mapbox-gl"],
          },
        },
      },
    },
  };
});
