// Number of stations (keep in sync with stations.json)
export type Station =
  | "Windsor"
  | "Sonoma County Airport"
  | "Santa Rosa North"
  | "Santa Rosa Downtown"
  | "Rohnert Park"
  | "Cotati"
  | "Petaluma North"
  | "Petaluma Downtown"
  | "Novato San Marin"
  | "Novato Downtown"
  | "Novato Hamilton"
  | "Marin Civic Center"
  | "San Rafael"
  | "Larkspur";

export const STATION_COUNT = 14;

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
  message?: string;
  title?: string;
  severity?: AlertSeverity;
  startsAt?: string; // ISO date string (YYYY-MM-DD or full ISO)
  endsAt?: string; // ISO date string
  active?: boolean; // explicit switch to enable/disable
}
