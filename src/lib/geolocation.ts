// src/lib/geolocation.ts
export type GeoPoint = {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
};

export type StopWatching = () => void;

export function watchPosition(
  onPoint: (p: GeoPoint) => void,
  onError: (err: GeolocationPositionError) => void
): StopWatching {
  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation não disponível neste navegador.");
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onPoint({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ts: pos.timestamp || Date.now(),
      });
    },
    onError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    }
  );

  return () => navigator.geolocation.clearWatch(watchId);
}