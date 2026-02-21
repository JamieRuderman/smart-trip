import { transit_realtime } from "gtfs-realtime-bindings";

const BASE = "http://api.511.org/transit";

export async function fetchGtfsRt(
  feed: "servicealerts" | "vehiclepositions" | "tripupdates"
): Promise<transit_realtime.IFeedMessage> {
  const apiKey = process.env.TRANSIT_511_API_KEY;
  if (!apiKey) throw new Error("Missing TRANSIT_511_API_KEY");

  const url = `${BASE}/${feed}?api_key=${apiKey}&agency=SA`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`511.org ${feed} responded ${res.status}`);

  const buffer = await res.arrayBuffer();
  return transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

export function getTranslation(
  translated: transit_realtime.ITranslatedString | null | undefined
): string {
  if (!translated?.translation?.length) return "";
  const en = translated.translation.find((t) => t.language === "en");
  return en?.text ?? translated.translation[0]?.text ?? "";
}
