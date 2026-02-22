import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (not just VITE_* prefixed) so we can read USE_SAMPLE_DATA
  const env = loadEnv(mode, process.cwd(), "");
  const useSampleData = env.USE_SAMPLE_DATA === "true";

  return {
    server: {
      host: "::",
      port: 3210,
      // When not using sample data, proxy /api to a local vercel dev instance
      proxy:
        mode === "development" && !useSampleData
          ? { "/api": "http://localhost:3000" }
          : undefined,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      // When USE_SAMPLE_DATA=true, intercept API routes and serve local JSON files
      mode === "development" &&
        useSampleData && {
          name: "sample-api-mock",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          configureServer(server: any) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            server.middlewares.use("/api/gtfsrt/tripupdates", (_req: any, res: any) => {
              const data = readFileSync(
                resolve(__dirname, "sample/tripupdates.json"),
                "utf-8"
              );
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(data);
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            server.middlewares.use("/api/gtfsrt/alerts", (_req: any, res: any) => {
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
