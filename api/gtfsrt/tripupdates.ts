import { createGtfsRtHandler } from "../_handler.js";
import {
  normalizeTripUpdates,
  TRIPUPDATES_FRESHNESS_MS,
} from "../_tripUpdatesFeed.js";

export default createGtfsRtHandler({
  feed: "tripupdates",
  sampleFile: "data/511/realtime-samples/tripupdates.json",
  cacheControl: "s-maxage=30, stale-while-revalidate=15",
  freshnessMs: TRIPUPDATES_FRESHNESS_MS, // ≤90 upstream calls/hr
  transform: (feed) => normalizeTripUpdates(feed),
});
