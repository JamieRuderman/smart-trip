// gtfs-realtime-bindings is a CommonJS module (module.exports = $root).
// A default ESM import gives us the $root object; we re-export transit_realtime
// so consuming files can use enum values without importing the package directly.
import GtfsRealtimeBindings, {
  transit_realtime as transitRealtimeTypes,
} from "gtfs-realtime-bindings";

type GtfsRealtimeModule = {
  transit_realtime: typeof transitRealtimeTypes;
};

export const transit_realtime = (GtfsRealtimeBindings as GtfsRealtimeModule).transit_realtime;

const BASE = "http://api.511.org/transit";

export async function fetchGtfsRt(
  feed: "servicealerts" | "vehiclepositions" | "tripupdates"
): Promise<transitRealtimeTypes.FeedMessage> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) throw new Error("Missing TRANSIT_511_API_KEY");

  const url = `${BASE}/${feed}?api_key=${apiKey}&agency=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`511.org ${feed} responded ${res.status}`);

  const buffer = await res.arrayBuffer();
  return transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

export function getTranslation(
  translated: transitRealtimeTypes.ITranslatedString | null | undefined
): string {
  if (!translated?.translation?.length) return "";
  const en = translated.translation.find((translation) => translation.language === "en");
  return en?.text ?? translated.translation[0]?.text ?? "";
}
