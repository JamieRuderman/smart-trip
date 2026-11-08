import type { Station } from "@/types/smartSchedule";
import { FERRY_CONSTANTS } from "./fareConstants";

/** San Francisco: not a SMART station, reached by the Golden Gate ferry from
 *  Larkspur. */
export const SAN_FRANCISCO = "San Francisco";

/** A trip end the rider can pick — a SMART station, or San Francisco. */
export type Place = Station | typeof SAN_FRANCISCO;

/** The SMART station a place is reached from. */
export function placeStation(place: Place): Station {
  return place === SAN_FRANCISCO ? FERRY_CONSTANTS.FERRY_STATION : place;
}

/** Whether a trip between these ends rides the ferry at its Larkspur end. */
export function isFerryLeg(from: Place | "", to: Place | ""): boolean {
  return from === SAN_FRANCISCO || to === SAN_FRANCISCO;
}

/** The ends a rider picked, from a leg's stations and whether its Larkspur end
 *  continues by ferry to San Francisco. */
export function legPlaces(
  fromStation: Station,
  toStation: Station,
  viaFerry: boolean,
): { from: Place; to: Place } {
  const place = (station: Station): Place =>
    viaFerry && station === FERRY_CONSTANTS.FERRY_STATION ? SAN_FRANCISCO : station;
  return { from: place(fromStation), to: place(toStation) };
}
