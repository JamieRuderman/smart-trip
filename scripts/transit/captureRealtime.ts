/*
 * Capture a contemporaneous snapshot of SMART's static + realtime feeds from
 * 511.org and save the decoded realtime payloads under data/511/raw/realtime/.
 *
 * Also reports whether the realtime trip ids (trip_update.trip.trip_id and
 * vehicle.trip.trip_id) actually match the static GTFS trip_ids — fetched at
 * the SAME moment, using the trip-descriptor id (NOT the FeedEntity.id).
 *
 *   TRANSIT_511_API_KEY=… tsx scripts/transit/captureRealtime.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { extractGtfsFeedFromZip } from "./shared.js";

const transit_realtime = (
  GtfsRealtimeBindings as unknown as {
    transit_realtime: typeof import("gtfs-realtime-bindings").transit_realtime;
  }
).transit_realtime;

const apiKey = process.env.TRANSIT_511_API_KEY;
if (!apiKey) throw new Error("Missing TRANSIT_511_API_KEY");

const RT_DIR = path.resolve("data/511/raw/realtime");

async function fetchStatic() {
  const url = `https://api.511.org/transit/datafeeds?api_key=${apiKey}&operator_id=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`static datafeeds -> ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  return extractGtfsFeedFromZip(
    zip,
    "SA",
    "datafeeds?operator_id=SA",
    new Date().toISOString(),
  );
}

async function fetchRt(feed: "tripupdates" | "vehiclepositions" | "servicealerts") {
  const url = `http://api.511.org/transit/${feed}?api_key=${apiKey}&agency=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${feed} -> ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const msg = transit_realtime.FeedMessage.decode(bytes);
  return transit_realtime.FeedMessage.toObject(msg, {
    longs: String,
    enums: String,
    defaults: false,
  }) as { entity?: Array<Record<string, unknown>> };
}

function tripIdsFrom(
  obj: { entity?: Array<Record<string, unknown>> },
  pick: (e: Record<string, unknown>) => unknown,
): string[] {
  return (obj.entity ?? [])
    .map((e) => pick(e))
    .filter((v): v is string => typeof v === "string");
}

async function main() {
  const rtFetchedAt = new Date().toISOString();
  const staticFeed = await fetchStatic();
  const tu = await fetchRt("tripupdates");
  const vp = await fetchRt("vehiclepositions");
  const sa = await fetchRt("servicealerts");

  fs.mkdirSync(RT_DIR, { recursive: true });
  const write = (name: string, data: unknown) =>
    fs.writeFileSync(
      path.join(RT_DIR, name),
      `${JSON.stringify({ fetchedAt: rtFetchedAt, agency: "SA", ...(data as object) }, null, 2)}\n`,
    );
  write("tripupdates.json", tu);
  write("vehiclepositions.json", vp);
  write("servicealerts.json", sa);

  const staticIds = new Set(staticFeed.trips.map((t) => t.trip_id));
  const tuTripIds = tripIdsFrom(
    tu,
    (e) => (e.tripUpdate as { trip?: { tripId?: string } })?.trip?.tripId,
  );
  const vpTripIds = tripIdsFrom(
    vp,
    (e) => (e.vehicle as { trip?: { tripId?: string } })?.trip?.tripId,
  );
  const tuEntityIds = (tu.entity ?? []).map((e) => e.id).slice(0, 5);

  const matched = tuTripIds.filter((id) => staticIds.has(id));
  const unmatched = tuTripIds.filter((id) => !staticIds.has(id));

  console.log("\n========== TRIP ID RECONCILIATION ==========");
  console.log("static feed fetchedAt:", staticFeed.fetchedAt);
  console.log("realtime fetchedAt:   ", rtFetchedAt);
  console.log("static trip_id count: ", staticIds.size);
  console.log("sample static trip_ids:", [...staticIds].slice(0, 4));
  console.log("\ntripupdates entities:", (tu.entity ?? []).length);
  console.log("FeedEntity.id (NOT a trip id):", tuEntityIds);
  console.log("tripUpdate.trip.tripId sample:", tuTripIds.slice(0, 6));
  console.log("vehicle.trip.tripId sample:   ", vpTripIds.slice(0, 6));
  console.log(
    `\n>>> tripUpdate.trip.tripId IN static trip_ids: ${matched.length}/${tuTripIds.length}`,
  );
  console.log("matched samples:  ", matched.slice(0, 4));
  console.log("unmatched samples:", unmatched.slice(0, 4));
  console.log("============================================\n");
}

main().catch((err) => {
  console.error("captureRealtime failed:", err);
  process.exitCode = 1;
});
