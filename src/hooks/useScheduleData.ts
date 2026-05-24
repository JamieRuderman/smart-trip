import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  isSchedulePayload,
  type SchedulePayload,
} from "@/data/scheduleData";
import { scheduleUrl } from "@/lib/env";
import { APP_REFRESH_EVENT } from "@/lib/refreshEvents";
import {
  getScheduleMeta,
  setScheduleData,
  subscribeSchedule,
  type ScheduleSource,
} from "@/lib/scheduleUtils";

const STORAGE_KEY = "smart-schedule-payload";

export type { ScheduleSource };

export interface ScheduleDataState {
  /** Refresh token. Stable when nothing has changed; advances whenever the
   *  underlying schedule cache is rebuilt. Other hooks key memos off this. */
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

export function useScheduleData(): ScheduleDataState {
  const meta = useSyncExternalStore(subscribeSchedule, getScheduleMeta, getScheduleMeta);
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
        // setScheduleData publishes cache + meta atomically and notifies
        // subscribers; useSyncExternalStore picks up the new snapshot.
        setScheduleData(data, "remote");
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
      setScheduleData(cached, "cached");
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

  return {
    version: String(meta.version),
    source: meta.source,
    generatedAt: meta.generatedAt,
  };
}
