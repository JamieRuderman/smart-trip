// The Station union + count are generated from the SMART GTFS feed by
// scripts/updateTransitFeeds.ts. Edit CURATED_STATION_ZONES there (not here)
// when stations are added or fare zones reshuffle.
export type { Station } from "@/data/generated/stations.generated";
export { STATION_COUNT } from "@/data/generated/stations.generated";

// Fare-related types
export type FareType = 
  | "adult"
  | "youth" 
  | "senior"
  | "disabled"
  | "clipper-start";

export type PaymentMethod = "clipper" | "eticket";

export interface FareInfo {
  fareType: FareType;
  paymentMethod: PaymentMethod;
  zones: number;
  price: number;
  description: string;
}

export interface StationZone {
  station: Station;
  zone: number;
}

export interface FerryConnection {
  depart: string;
  arrive: string;
}

// Helper type for a tuple of N strings
export type TupleOf<
  T,
  N extends number,
  R extends T[] = []
> = R["length"] extends N ? R : TupleOf<T, N, [T, ...R]>;

export interface TrainTrip {
  trip: number;
  times: TupleOf<string, typeof STATION_COUNT>;
}

export interface TrainSchedule {
  southbound: TrainTrip[];
  northbound: TrainTrip[];
}

// Service alerts
export type AlertSeverity = "info" | "warning" | "critical";

export interface ServiceAlertData {
  id: string;
  fingerprint: string;
  message?: string;
  title?: string;
  severity?: AlertSeverity;
  startsAt?: string; // ISO date string (YYYY-MM-DD or full ISO)
  endsAt?: string; // ISO date string
  sourceUpdatedAt?: string; // ISO date string from feed timestamp
  active?: boolean; // explicit switch to enable/disable
}
