import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (not just VITE_* prefixed) so we can read USE_SAMPLE_DATA
  const env = loadEnv(mode, process.cwd(), "");
  const useSampleData = env.USE_SAMPLE_DATA === "true";
  const devApiProxyTarget = env.DEV_API_PROXY_TARGET?.trim() || "http://localhost:3000";

  return {
    server: {
      host: "::",
      port: 3210,
      // When not using sample data, proxy /api to a local vercel dev instance
      proxy:
        mode === "development" && !useSampleData
          ? { "/api": devApiProxyTarget }
          : undefined,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      // When USE_SAMPLE_DATA=true, intercept API routes and serve local JSON files
      mode === "development" &&
        useSampleData && {
          name: "sample-api-mock",
          configureServer(server: ViteDevServer) {
            server.middlewares.use("/api/gtfsrt/tripupdates", (req: IncomingMessage, res: ServerResponse) => {
              void req;
              const data = readFileSync(
                resolve(__dirname, "sample/tripupdates.json"),
                "utf-8"
              );
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(data);
            });
            server.middlewares.use("/api/gtfsrt/alerts", (req: IncomingMessage, res: ServerResponse) => {
              void req;
              const data = readFileSync(
                resolve(__dirname, "sample/alert.json"),
                "utf-8"
              );
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(data);
            });
          },
        },
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
