import type { Place } from "@/lib/places";

/**
 * Deterministic slug for a station name. Used both for URL paths
 * (`/stations/<slug>/`) and as the data attribute on the live-departures
 * placeholder so the static and dynamic surfaces agree on identifiers.
 *
 * Examples:
 *   "Sonoma County Airport" -> "sonoma-county-airport"
 *   "Larkspur"              -> "larkspur"
 *   "Santa Rosa Downtown"   -> "santa-rosa-downtown"
 */
export function stationSlug(station: Place): string {
  return station
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug for an origin→destination pair. Order matters because the page
 * presents one direction of travel; we deliberately do *not* canonicalise the
 * order alphabetically.
 */
export function routePairSlug(from: Place, to: Place): string {
  return `${stationSlug(from)}-to-${stationSlug(to)}`;
}
