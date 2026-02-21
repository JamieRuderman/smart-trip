const DEFAULT_SCHEDULE_URL = "/data/schedules.json";

function readOptionalEnvString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const isDev = import.meta.env.DEV;

export const scheduleUrl =
  readOptionalEnvString(import.meta.env.VITE_SCHEDULE_URL) ??
  DEFAULT_SCHEDULE_URL;

/**
 * Base URL for API calls. Defaults to "" (relative) for web deployments.
 * Set VITE_API_BASE_URL to the production Vercel URL for native Capacitor builds
 * so that /api/gtfsrt/* calls resolve correctly from file:// origins.
 */
export const apiBaseUrl =
  readOptionalEnvString(import.meta.env.VITE_API_BASE_URL) ?? "";
