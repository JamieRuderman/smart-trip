import type { ServiceAlertData } from "@/types/smartSchedule";

function normalizePart(value?: string): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashDjb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function buildAlertFingerprint(parts: {
  id: string;
  title?: string;
  message?: string;
  startsAt?: string;
  endsAt?: string;
}): string {
  const raw = [
    normalizePart(parts.id),
    normalizePart(parts.title),
    normalizePart(parts.message),
    normalizePart(parts.startsAt),
    normalizePart(parts.endsAt),
  ].join("|");
  return hashDjb2(raw);
}

export function getAlertFingerprint(alert: ServiceAlertData): string {
  return (
    alert.fingerprint ||
    buildAlertFingerprint({
      id: alert.id,
      title: alert.title,
      message: alert.message,
      startsAt: alert.startsAt,
      endsAt: alert.endsAt,
    })
  );
}

/**
 * Return the stable identity used for dismissal persistence.
 *
 * Alert copy and active-period timestamps are intentionally excluded: agencies
 * routinely edit those fields while an alert is live, and those edits should
 * not undo an explicit dismissal. The fingerprint fallback only matters for a
 * malformed alert without an agency-provided ID.
 */
export function getAlertDismissalKey(alert: ServiceAlertData): string {
  const id = normalizePart(alert.id);
  return id ? `id:${id}` : `fingerprint:${getAlertFingerprint(alert)}`;
}
