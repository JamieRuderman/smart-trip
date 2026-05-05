/*
 * Fetch step: pulls the SMART + Golden Gate Ferry GTFS zips from 511.org,
 * parses every GTFS table this app reads into the GtfsFeed envelope, and
 * writes the result to data/511/raw/{smart,ferry}.json (committed, used
 * as the sole input to the transform step).
 *
 * Requires TRANSIT_511_API_KEY in the environment. The api_key is stripped
 * from the persisted `sourceUrl` so the committed JSON doesn't leak it.
 *
 * Run via:
 *   TRANSIT_511_API_KEY=… tsx scripts/transit/fetch.ts
 *   (or `npm run update-transit`, which runs fetch + transform)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";
import dotenv from "dotenv";

// Load env vars from both .env and .env.local (Vite convention). .env.local
// overrides .env so contributors can keep secrets in the gitignored file.
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import type { GtfsFeed, GtfsOperatorId, GtfsRawManifest } from "../../src/types/gtfs.js";
import { extractGtfsFeedFromZip } from "./shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RAW_DIR = path.resolve(__dirname, "../../data/511/raw");
const SMART_RAW_PATH = path.resolve(RAW_DIR, "smart.json");
const FERRY_RAW_PATH = path.resolve(RAW_DIR, "ferry.json");
const MANIFEST_PATH = path.resolve(RAW_DIR, ".fetched-at.json");

const BASE_GTFS_URL = "https://api.511.org/transit/datafeeds";
const SMART_OPERATOR_ID: GtfsOperatorId = "SA";
const FERRY_OPERATOR_ID: GtfsOperatorId = "GF";

const feedUrl = (token: string, operatorId: GtfsOperatorId) =>
  `${BASE_GTFS_URL}?api_key=${token}&operator_id=${operatorId}`;

const redactedUrl = (operatorId: GtfsOperatorId) =>
  `${BASE_GTFS_URL}?operator_id=${operatorId}`;

async function fetchZip(url: string): Promise<{ zip: AdmZip; bytes: number }> {
  const response = await fetch(url);
  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch (error) {
      errorBody = `unable to read error body: ${(error as Error).message}`;
    }
    throw new Error(
      `Failed to fetch GTFS feed (${response.status} ${response.statusText}) - ${errorBody.trim()}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { zip: new AdmZip(buffer), bytes: buffer.length };
}

function writeFeed(targetPath: string, feed: GtfsFeed): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(feed, null, 2)}\n`, "utf-8");
}

export async function fetchAndPersistRawFeeds(): Promise<{
  smart: GtfsFeed;
  ferry: GtfsFeed;
}> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TRANSIT_511_API_KEY environment variable is required to fetch raw 511 data.",
    );
  }

  console.log("Fetching SMART + Golden Gate Ferry GTFS feeds from 511.org…");
  const fetchedAt = new Date().toISOString();
  const [smartFetch, ferryFetch] = await Promise.all([
    fetchZip(feedUrl(apiKey, SMART_OPERATOR_ID)),
    fetchZip(feedUrl(apiKey, FERRY_OPERATOR_ID)),
  ]);

  const smartFeed = extractGtfsFeedFromZip(
    smartFetch.zip,
    SMART_OPERATOR_ID,
    redactedUrl(SMART_OPERATOR_ID),
    fetchedAt,
  );
  const ferryFeed = extractGtfsFeedFromZip(
    ferryFetch.zip,
    FERRY_OPERATOR_ID,
    redactedUrl(FERRY_OPERATOR_ID),
    fetchedAt,
  );

  writeFeed(SMART_RAW_PATH, smartFeed);
  writeFeed(FERRY_RAW_PATH, ferryFeed);

  const manifest: GtfsRawManifest = {
    schemaVersion: 1,
    smart: {
      fetchedAt,
      sourceUrl: redactedUrl(SMART_OPERATOR_ID),
      bytes: smartFetch.bytes,
    },
    ferry: {
      fetchedAt,
      sourceUrl: redactedUrl(FERRY_OPERATOR_ID),
      bytes: ferryFetch.bytes,
    },
  };
  fs.writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );

  console.log(
    `Wrote raw 511 snapshots:\n  ${path.relative(process.cwd(), SMART_RAW_PATH)} (${smartFetch.bytes} zip bytes)\n  ${path.relative(process.cwd(), FERRY_RAW_PATH)} (${ferryFetch.bytes} zip bytes)`,
  );

  return { smart: smartFeed, ferry: ferryFeed };
}

// Allow direct invocation: `tsx scripts/transit/fetch.ts`.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  fetchAndPersistRawFeeds().catch((error) => {
    console.error("Failed to fetch raw 511 feeds:", error);
    process.exitCode = 1;
  });
}
