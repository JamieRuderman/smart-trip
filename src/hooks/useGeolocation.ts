import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { haversineKm } from "@/lib/stationUtils";

interface GeolocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speedMps: number | null;
  heading: number | null;
  timestampMs: number | null;
  error: string | null;
  loading: boolean;
  requestLocation: () => void;
}

interface UseGeolocationOptions {
  watch?: boolean;
  autoRequestOnNative?: boolean;
  /**
   * On web, silently call getCurrentPosition on mount if the browser has
   * already granted the geolocation permission (no prompt is shown).
   * Defaults to true so that previously-approved permission is used immediately.
   */
  autoRequestOnWeb?: boolean;
}

export interface Coordinates {
  lat: number;
  lng: number;
  accuracy: number | null;
  speedMps: number | null;
  heading: number | null;
  timestampMs: number;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

/**
 * Minimal position shape `normalizeCoordinates` actually reads. Both the DOM
 * `GeolocationPosition` (web) and Capacitor's `Position` (native) satisfy it —
 * they differ only in members we don't use (e.g. `toJSON`), which is why a
 * direct cross-cast between them is rejected. Typing to this shape lets both
 * callers pass through without an unsafe cast.
 */
interface GeoReading {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp: number;
}

function normalizeCoordinates(
  pos: GeoReading,
  previous: Coordinates | null,
): Coordinates {
  const rawSpeed = pos.coords.speed;
  const timestampMs = Number.isFinite(pos.timestamp)
    ? pos.timestamp
    : Date.now();

  let speedMps =
    typeof rawSpeed === "number" && Number.isFinite(rawSpeed) && rawSpeed >= 0
      ? rawSpeed
      : null;

  if (speedMps == null && previous) {
    const dtSeconds = (timestampMs - previous.timestampMs) / 1000;
    if (dtSeconds >= 1.5) {
      const meters = haversineMeters(
        previous.lat,
        previous.lng,
        pos.coords.latitude,
        pos.coords.longitude,
      );
      speedMps = meters / dtSeconds;
    }
  }

  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy:
      typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
        ? pos.coords.accuracy
        : null,
    speedMps,
    heading:
      typeof pos.coords.heading === "number" && Number.isFinite(pos.coords.heading)
        ? pos.coords.heading
        : null,
    timestampMs,
  };
}

async function fetchNativeLocation(): Promise<Coordinates> {
  const { Geolocation } = await import("@capacitor/geolocation");
  await Geolocation.requestPermissions();
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
  return normalizeCoordinates(pos, null);
}

function fetchWebLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(normalizeCoordinates(pos, null)),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

/** Options for a background fix: accept a recent cached position so it's
 *  usually instant, and don't hang around waiting on a cold GPS. */
const BACKGROUND_FIX_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 60_000,
};

/**
 * One-shot fix that never shows a permission prompt: resolves null unless the
 * user already granted location access, or if the fix fails or times out. For
 * checks the user didn't explicitly ask for, where a prompt would be out of
 * place.
 */
export async function getLocationFixIfGranted(): Promise<Coordinates | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const { location, coarseLocation } = await Geolocation.checkPermissions();
      if (location !== "granted" && coarseLocation !== "granted") return null;
      const pos = await Geolocation.getCurrentPosition(BACKGROUND_FIX_OPTIONS);
      return normalizeCoordinates(pos, null);
    }
    if (!("geolocation" in navigator) || !("permissions" in navigator)) {
      return null;
    }
    const { state } = await navigator.permissions.query({ name: "geolocation" });
    if (state !== "granted") return null;
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(normalizeCoordinates(pos, null)),
        () => resolve(null),
        BACKGROUND_FIX_OPTIONS,
      );
    });
  } catch {
    return null;
  }
}

/** A prefetched fix started longer ago than this is refetched, not reused. */
const PREFETCH_STALE_MS = 2 * 60 * 1000;

/**
 * Warm a no-prompt fix (see `getLocationFixIfGranted`) while `enabled`, and
 * return a getter for it — so a check on a later tap usually resolves
 * instantly. The getter refetches a stale fix and gives up with null after
 * `maxWaitMs`, so a slow GPS never holds the caller up for long.
 */
export function usePrefetchedLocationFix(
  enabled: boolean,
  maxWaitMs = 3000,
): () => Promise<Coordinates | null> {
  const pendingRef = useRef<{
    startedAt: number;
    fix: Promise<Coordinates | null>;
  } | null>(null);

  const start = useCallback(() => {
    const pending = { startedAt: Date.now(), fix: getLocationFixIfGranted() };
    pendingRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    if (enabled) start();
  }, [enabled, start]);

  return useCallback(() => {
    let pending = pendingRef.current;
    if (!pending || Date.now() - pending.startedAt > PREFETCH_STALE_MS) {
      pending = start();
    }
    return Promise.race([
      pending.fix,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs)),
    ]);
  }, [start, maxWaitMs]);
}

export function useGeolocation({
  watch = false,
  autoRequestOnNative = true,
  autoRequestOnWeb = true,
}: UseGeolocationOptions = {}): GeolocationState {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nativeWatchIdRef = useRef<string | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<Coordinates | null>(null);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = Capacitor.isNativePlatform()
        ? await fetchNativeLocation()
        : await fetchWebLocation();
      lastCoordsRef.current = result;
      setCoords(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      if (autoRequestOnNative) void requestLocation();
      return;
    }
    // Web: only auto-request if permission is already granted (no prompt shown).
    if (autoRequestOnWeb && "permissions" in navigator) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (result.state === "granted") void requestLocation();
        })
        .catch(() => {/* permissions API unavailable — skip */});
    }
  }, [autoRequestOnNative, autoRequestOnWeb, requestLocation]);

  useEffect(() => {
    let cancelled = false;

    const stopWatchers = async () => {
      if (webWatchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
      if (nativeWatchIdRef.current != null) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          await Geolocation.clearWatch({ id: nativeWatchIdRef.current });
        } catch {
          // Ignore cleanup failures.
        }
        nativeWatchIdRef.current = null;
      }
    };

    const startWatching = async () => {
      if (!watch) return;

      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        await Geolocation.requestPermissions();
        const watchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
            minimumUpdateInterval: 1000,
          },
          (position, watchError) => {
            if (cancelled) return;
            if (watchError) {
              setError(watchError.message ?? "Location unavailable");
              return;
            }
            if (position?.coords) {
              const normalized = normalizeCoordinates(
                position,
                lastCoordsRef.current,
              );
              lastCoordsRef.current = normalized;
              setCoords(normalized);
              setError(null);
            }
          }
        );
        nativeWatchIdRef.current = watchId;
        return;
      }

      if (!("geolocation" in navigator)) {
        setError("Geolocation not supported");
        return;
      }

      webWatchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelled) return;
          const normalized = normalizeCoordinates(position, lastCoordsRef.current);
          lastCoordsRef.current = normalized;
          setCoords(normalized);
          setError(null);
        },
        (watchError) => {
          if (cancelled) return;
          setError(watchError.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    };

    if (!watch) {
      void stopWatchers();
      return () => {
        cancelled = true;
        void stopWatchers();
      };
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        void stopWatchers();
      } else {
        void startWatching();
      }
    };

    void startWatching();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void stopWatchers();
    };
  }, [watch]);

  return {
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    accuracy: coords?.accuracy ?? null,
    speedMps: coords?.speedMps ?? null,
    heading: coords?.heading ?? null,
    timestampMs: coords?.timestampMs ?? null,
    error,
    loading,
    requestLocation,
  };
}
