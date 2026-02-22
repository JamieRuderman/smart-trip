import { createRequire } from "node:module";

// gtfs-realtime-bindings is a CommonJS module (module.exports = $root).
// We load it via createRequire so Node.js never tries a static ESM named-import
// check (which would fail because the package's CJS exports aren't statically
// detectable). We re-export transit_realtime so consuming files can use enum
// values without importing from gtfs-realtime-bindings directly.
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const transit_realtime = (_require("gtfs-realtime-bindings") as any).transit_realtime as any;

const BASE = "http://api.511.org/transit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchGtfsRt(
  feed: "servicealerts" | "vehiclepositions" | "tripupdates"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) throw new Error("Missing TRANSIT_511_API_KEY");

  const url = `${BASE}/${feed}?api_key=${apiKey}&agency=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`511.org ${feed} responded ${res.status}`);

  const buffer = await res.arrayBuffer();
  return transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTranslation(translated: any): string {
  if (!translated?.translation?.length) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const en = translated.translation.find((t: any) => t.language === "en");
  return en?.text ?? translated.translation[0]?.text ?? "";
}
