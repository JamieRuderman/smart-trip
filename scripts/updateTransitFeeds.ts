/*
 * Updates SMART train and Golden Gate Ferry schedules using 511.org GTFS feeds.
 *
 * Usage:
 *   TRANSIT_511_API_KEY=your_key npm run update-transit
 *
 * This is a thin wrapper around the two pipeline phases:
 *   1. scripts/transit/fetch.ts     — pulls 511 zips, persists raw JSON
 *      under data/511/raw/{smart,ferry}.json
 *   2. scripts/transit/transform.ts — re-emits every TS module under
 *      src/data/generated/ from the persisted raw JSON
 *
 * If you only need to re-derive the generated TS modules (for example,
 * after editing the transform logic), run `npm run regen-transit` —
 * it skips the fetch and works without an API key.
 */

import process from "node:process";

import { fetchAndPersistRawFeeds } from "./transit/fetch.js";
import { transformRawToGenerated } from "./transit/transform.js";

async function updateFeeds(): Promise<void> {
  await fetchAndPersistRawFeeds();
  transformRawToGenerated();
}

updateFeeds().catch((error) => {
  console.error("Failed to update transit feeds:", error);
  process.exitCode = 1;
});
