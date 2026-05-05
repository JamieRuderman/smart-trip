import type { Station } from "@/types/smartSchedule";

/** A single GPS sample augmented with the wall-clock time it was observed. */
export interface UserSample {
  lat: number;
  lng: number;
  speedMps: number | null;
  heading: number | null;
  nowMs: number;
}

/** Boarding primer: tracks how long the user has been inside one station's
 *  platform radius. The primer must reach PLATFORM_DWELL_MS before a
 *  departure event can fire. */
export interface BoardingState {
  station: Station | null;
  /** Epoch ms when the current dwell started (null if not at a platform). */
  sinceMs: number | null;
}

/** Emitted the tick the user steps off the platform while moving fast enough
 *  to plausibly be on a train. Drives departure-correlated engagement. */
export interface DepartureEvent {
  fromStation: Station;
  atMs: number;
}

/** Per-train transition history. Records the most recent stopped→moving
 *  event so we can correlate it with a user departure. */
export interface TrainTransitionState {
  lastSpeedMps: number | null;
  /** Station the train was last seen sitting near. */
  lastStationaryNearStation: Station | null;
  /** Epoch ms of the most recent stopped→moving transition. */
  lastDepartedAtMs: number | null;
  /** Station that transition departed from. */
  lastDepartedFromStation: Station | null;
  /** Epoch ms the train was last present in the GTFS-RT feed. */
  lastSeenAtMs: number;
}

export type TrainTransitionMap = Map<string, TrainTransitionState>;
