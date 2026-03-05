export const APP_REFRESH_EVENT = "smart:app-refresh";

export function emitAppRefreshEvent(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APP_REFRESH_EVENT));
}
