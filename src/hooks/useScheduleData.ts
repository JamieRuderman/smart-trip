import { useCallback, useEffect, useRef, useState } from "react";
import {
  bundledSchedulePayload,
  isSchedulePayload,
  type SchedulePayload,
} from "@/data/scheduleData";
import { scheduleUrl } from "@/lib/env";
import { APP_REFRESH_EVENT } from "@/lib/refreshEvents";
import { setScheduleData } from "@/lib/scheduleUtils";

const STORAGE_KEY = "smart-schedule-payload";

/**
 * Where the currently-displayed schedule data came from.
 * - `remote`  — fresh fetch from the deployed `/data/schedules.json`
 * - `cached`  — last successful fetch, replayed from localStorage
 * - `bundled` — build-time copy compiled into the app bundle (offline fallback)
 *
 * Surfaced to the UI so users can tell when they're looking at cached or
 * bundled data — important if the cron-refreshed feed has gone stale.
 */
export type ScheduleSource = "remote" | "cached" | "bundled";

export interface ScheduleDataState {
  /** Refresh token. Stable when nothing has changed; ISO timestamp (or
   *  source label) when it has. Other hooks key memos off this. */
  version: string;
  /** Origin of the currently-applied schedule. */
  source: ScheduleSource;
  /** Parsed `generatedAt` timestamp from the payload, or null if missing
   *  (older bundled fallbacks may lack one). */
  generatedAt: Date | null;
}

function loadCachedPayload(): SchedulePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSchedulePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function storeCachedPayload(payload: SchedulePayload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors (quota, privacy mode).
  }
}

function parseGeneratedAt(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function useScheduleData(): ScheduleDataState {
  const [state, setState] = useState<ScheduleDataState>(() => ({
    version: bundledSchedulePayload.generatedAt ?? "bundled",
    source: "bundled",
    generatedAt: parseGeneratedAt(bundledSchedulePayload.generatedAt),
  }));
  const mountedRef = useRef(true);
  const inFlightRefreshRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshSchedulePayload = useCallback((): Promise<void> => {
    if (inFlightRefreshRef.current) {
      return inFlightRefreshRef.current;
    }

    const refreshPromise = fetch(scheduleUrl, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!mountedRef.current || !data || !isSchedulePayload(data)) return;
        setScheduleData(data);
        setState({
          version: data.generatedAt ?? "remote",
          source: "remote",
          generatedAt: parseGeneratedAt(data.generatedAt),
        });
        storeCachedPayload(data);
      })
      .catch(() => {
        // Ignore network errors and keep bundled or cached data.
      })
      .finally(() => {
        inFlightRefreshRef.current = null;
      });

    inFlightRefreshRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    const cached = loadCachedPayload();
    if (cached) {
      setScheduleData(cached);
      setState({
        version: cached.generatedAt ?? "cached",
        source: "cached",
        generatedAt: parseGeneratedAt(cached.generatedAt),
      });
    }

    void refreshSchedulePayload();
  }, [refreshSchedulePayload]);

  useEffect(() => {
    const onAppRefresh = () => {
      void refreshSchedulePayload();
    };

    window.addEventListener(APP_REFRESH_EVENT, onAppRefresh);
    return () => {
      window.removeEventListener(APP_REFRESH_EVENT, onAppRefresh);
    };
  }, [refreshSchedulePayload]);

  return state;
}
