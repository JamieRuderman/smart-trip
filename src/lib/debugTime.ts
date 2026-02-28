export function parseDebugTimeFromUrl(): Date | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("debugTime");
  if (!raw) return null;

  // Supports "HH:MM" or "HH:MM:SS" and anchors it to today's date.
  const timeMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (timeMatch) {
    const now = new Date();
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3] ?? "0");
    now.setHours(hours, minutes, seconds, 0);
    return now;
  }

  // Also supports full date/time strings (e.g. 2026-02-21T17:28:00).
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
