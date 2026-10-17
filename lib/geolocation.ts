'use client';

/**
 * Best-effort browser location for check-in.
 *
 * Never throws and never blocks the punch: whether a missing location is fatal
 * is the server's decision, since only it knows if the geofence is on and
 * whether this person is WFO. Asking here and failing closed would stop WFH
 * staff — and everyone, whenever the feature is off — from checking in over a
 * permission prompt that did not matter.
 *
 * The timeout is deliberately short. A check-in is the first thing an agent
 * does in the morning and a GPS fix that takes half a minute reads as a
 * frozen button; the server simply reports what it needs if nothing arrives.
 */
export interface Coords {
  latitude: number;
  longitude: number;
  accuracyM: number;
}

const TIMEOUT_MS = 10_000;

export function getCurrentCoords(): Promise<Coords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: Coords | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    // Belt and braces: some browsers have been seen to call neither callback
    // when permission is dismissed rather than denied.
    const timer = setTimeout(() => done(null), TIMEOUT_MS + 1_000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}
