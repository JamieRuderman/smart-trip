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

function normalizeCoordinates(
  pos: GeolocationPosition,
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
  return normalizeCoordinates(pos as GeolocationPosition, null);
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
                position as GeolocationPosition,
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
