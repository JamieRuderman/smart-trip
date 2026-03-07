import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

interface GeolocationState {
  lat: number | null;
  lng: number | null;
  error: string | null;
  loading: boolean;
  /** Manually trigger a location request (used by the "Use my location" button on web). */
  requestLocation: () => void;
}

async function fetchNativeLocation(): Promise<{ lat: number; lng: number }> {
  const { Geolocation } = await import("@capacitor/geolocation");
  await Geolocation.requestPermissions();
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 10000,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

function fetchWebLocation(): Promise<{ lat: number; lng: number }> {
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

export function useGeolocation(): GeolocationState {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  // On native: request automatically — the OS permission dialog is expected by users
  // On web: wait for explicit user action ("Use my location" button) to avoid
  //         triggering the browser permission dialog on page load
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      void requestLocation();
    }
  }, [requestLocation]);

  return {
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    error,
    loading,
    requestLocation,
  };
}
