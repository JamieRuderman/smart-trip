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

export function useScheduleData(): { version: string } {
  const [version, setVersion] = useState(
    bundledSchedulePayload.generatedAt ?? "bundled"
  );
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
        setVersion(data.generatedAt ?? "remote");
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
      setVersion(cached.generatedAt ?? "cached");
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

  return { version };
}
