import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

interface GeolocationState {
  lat: number | null;
  lng: number | null;
  error: string | null;
  loading: boolean;
  requestLocation: () => void;
}

interface UseGeolocationOptions {
  watch?: boolean;
  autoRequestOnNative?: boolean;
}

interface Coordinates {
  lat: number;
  lng: number;
}

async function fetchNativeLocation(): Promise<Coordinates> {
  const { Geolocation } = await import("@capacitor/geolocation");
  await Geolocation.requestPermissions();
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 10000,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

function fetchWebLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

export function useGeolocation({
  watch = false,
  autoRequestOnNative = true,
}: UseGeolocationOptions = {}): GeolocationState {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nativeWatchIdRef = useRef<string | null>(null);
  const webWatchIdRef = useRef<number | null>(null);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = Capacitor.isNativePlatform()
        ? await fetchNativeLocation()
        : await fetchWebLocation();
      setCoords(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Location unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (Capacitor.isNativePlatform() && autoRequestOnNative) {
      void requestLocation();
    }
  }, [autoRequestOnNative, requestLocation]);

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
      if (!watch) {
        await stopWatchers();
        return;
      }

      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        await Geolocation.requestPermissions();
        const watchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 15000,
          },
          (position, watchError) => {
            if (cancelled) return;
            if (watchError) {
              setError(watchError.message ?? "Location unavailable");
              return;
            }
            if (position?.coords) {
              setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
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
          setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
          setError(null);
        },
        (watchError) => {
          if (cancelled) return;
          setError(watchError.message);
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 15000,
        }
      );
    };

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
    error,
    loading,
    requestLocation,
  };
}
