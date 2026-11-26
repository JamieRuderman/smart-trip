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

interface Coordinates {
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

const LOCATION_SERVICES_OFF = "OS-PLUG-GLOC-0007";
const GET_LOCATION_TIMEOUT = "OS-PLUG-GLOC-0010";

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/** When a high-accuracy request last timed out, so later requests skip the
 *  wait until GPS might be back. */
let highAccuracyTimedOutAt = 0;
const HIGH_ACCURACY_RETRY_MS = 5 * 60_000;

function highAccuracyRecentlyTimedOut(): boolean {
  return Date.now() - highAccuracyTimedOutAt < HIGH_ACCURACY_RETRY_MS;
}

/** How old the latest fix can be and still count as where the rider is now —
 *  long enough that a sheet left open a while doesn't make a tap wait on the
 *  GPS again, short enough that it's still roughly where they are. */
const REUSE_FIX_MS = 5 * 60_000;

/** Fresh network-only fixes on Android arrive erratically (from 0.1 s to past
 *  the timeout), while a recent cached one comes back at once and is just as
 *  coarse. */
function lowAccuracyOptions<T extends { maximumAge?: number }>(options: T) {
  return {
    ...options,
    enableHighAccuracy: false,
    maximumAge: Math.max(options.maximumAge ?? 0, REUSE_FIX_MS),
  };
}

export async function fetchNativeLocation(
  options: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  { prompt = true, askToEnable = false } = {},
): Promise<Coordinates> {
  const { Geolocation } = await import("@capacitor/geolocation");
  if (prompt) {
    try {
      await Geolocation.requestPermissions();
    } catch (err) {
      // requestPermissions rejects outright while device location is off;
      // only getCurrentPosition shows Android's "Turn on location" dialog.
      if (!askToEnable || errorCode(err) !== LOCATION_SERVICES_OFF) throw err;
    }
  }
  const highAccuracy = !!options.enableHighAccuracy && !highAccuracyRecentlyTimedOut();
  let pos;
  try {
    pos = await Geolocation.getCurrentPosition(
      highAccuracy ? options : lowAccuracyOptions(options),
    );
  } catch (err) {
    // With GPS off (Android's network-only location mode) a high-accuracy
    // request never resolves.
    if (!highAccuracy || errorCode(err) !== GET_LOCATION_TIMEOUT) throw err;
    highAccuracyTimedOutAt = Date.now();
    pos = await Geolocation.getCurrentPosition(lowAccuracyOptions(options));
  }
  return normalizeCoordinates(pos, null);
}

function fetchWebLocation(
  options: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(normalizeCoordinates(pos, null)),
      (err) => reject(new Error(err.message)),
      options
    );
  });
}

/**
 * Location access already granted, checked without prompting: "precise",
 * "coarse" (Android's approximate-only grant), or null when not granted.
 */
async function grantedLocationAccess(): Promise<"precise" | "coarse" | null> {
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const { location, coarseLocation } = await Geolocation.checkPermissions();
    if (location === "granted") return "precise";
    return coarseLocation === "granted" ? "coarse" : null;
  }
  if (!("permissions" in navigator)) return null;
  const { state } = await navigator.permissions.query({ name: "geolocation" });
  return state === "granted" ? "precise" : null;
}

/** The app's latest fix from any source (one-shot or watch), and when it was
 *  taken, so one-off checks can reuse it instead of waking the GPS again. */
let latestFix: { fix: Coordinates; takenAt: number } | null = null;
let pendingFix: Promise<Coordinates | null> | null = null;

function rememberFix(fix: Coordinates): Coordinates {
  // Age from the position's own timestamp — a cached position can arrive
  // already old — clamped to now in case the device clock runs ahead. Never
  // let an older reading (e.g. a slow one-shot) replace a newer one.
  const takenAt = Math.min(Date.now(), fix.timestampMs);
  if (!latestFix || takenAt >= latestFix.takenAt) latestFix = { fix, takenAt };
  return fix;
}


/**
 * Where the rider is right now, without ever prompting for permission: while
 * access is granted, the app's latest fix if it's under five minutes old (e.g.
 * from the map's live watch), else a one-shot fix. Null when access isn't
 * granted (checked on every call, so a revoked grant stops cached fixes too)
 * or the fix fails. Concurrent callers share one request.
 */
export function getRecentLocationFix(): Promise<Coordinates | null> {
  if (!pendingFix) {
    pendingFix = (async () => {
      try {
        const access = await grantedLocationAccess();
        if (!access) {
          latestFix = null;
          return null;
        }
        if (latestFix && Date.now() - latestFix.takenAt <= REUSE_FIX_MS) {
          return latestFix.fix;
        }
        // Accept a position the OS cached in the last minute, and don't wait
        // long on a cold GPS.
        // Only ask for high accuracy with precise access: on Android 12+ a
        // high-accuracy request under an approximate-only grant prompts the
        // rider to upgrade to precise location.
        const options = {
          enableHighAccuracy: access === "precise",
          timeout: 8000,
          maximumAge: 60_000,
        };
        return rememberFix(
          Capacitor.isNativePlatform()
            ? await fetchNativeLocation(options, { prompt: false })
            : await fetchWebLocation(options),
        );
      } catch {
        return null;
      } finally {
        pendingFix = null;
      }
    })();
  }
  return pendingFix;
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

  const fetchLocation = useCallback(async (askToEnable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = Capacitor.isNativePlatform()
        ? await fetchNativeLocation(undefined, { askToEnable })
        : await fetchWebLocation();
      lastCoordsRef.current = result;
      setCoords(rememberFix(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  const requestLocation = useCallback(() => fetchLocation(true), [fetchLocation]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      if (autoRequestOnNative) void fetchLocation(false);
      return;
    }
    // Web: only auto-request if permission is already granted (no prompt shown).
    if (autoRequestOnWeb) {
      grantedLocationAccess()
        .then((access) => {
          if (access) void fetchLocation(false);
        })
        .catch(() => {/* permissions API unavailable — skip */});
    }
  }, [autoRequestOnNative, autoRequestOnWeb, fetchLocation]);

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

    const startWatching = async (highAccuracy = !highAccuracyRecentlyTimedOut()) => {
      if (!watch) return;

      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        let watchId: string | null = null;
        try {
          await Geolocation.requestPermissions();
          const watchOptions = { timeout: 10000, maximumAge: 0, minimumUpdateInterval: 1000 };
          watchId = await Geolocation.watchPosition(
            highAccuracy
              ? { ...watchOptions, enableHighAccuracy: true }
              : lowAccuracyOptions(watchOptions),
            (position, watchError) => {
              if (cancelled) return;
              // The plugin drops a watch once it times out, as a high-accuracy
              // one always does with GPS off.
              if (errorCode(watchError) === GET_LOCATION_TIMEOUT) {
                if (highAccuracy) highAccuracyTimedOutAt = Date.now();
                if (watchId) {
                  if (nativeWatchIdRef.current === watchId) nativeWatchIdRef.current = null;
                  // The plugin holds the dead watch's call until clearWatch releases it.
                  void Geolocation.clearWatch({ id: watchId }).catch(() => {});
                }
                void startWatching(false);
                return;
              }
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
                setCoords(rememberFix(normalized));
                setError(null);
              }
            }
          );
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Location unavailable");
          return;
        }
        // Cleanup or a hide during the awaits above found no id to clear.
        if (cancelled || document.hidden) {
          void Geolocation.clearWatch({ id: watchId }).catch(() => {});
          return;
        }
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
          setCoords(rememberFix(normalized));
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
