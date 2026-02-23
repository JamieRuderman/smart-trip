import type { ServiceAlertData } from "@/types/smartSchedule";
import { buildAlertFingerprint } from "@/lib/alertFingerprint";

// Edit this list to update live service alerts displayed in the app.
// Set `active` to true to display. You can also control visibility by date range.
export const serviceAlerts: ServiceAlertData[] = [
  {
    id: "2025-06-23-windsor-temp-suspension",
    title: "Service Alert",
    message:
      "Effective Monday, June 23, 2025, the first three Southbound weekday trips departing from Windsor are temporarily suspended. These trips will depart from Sonoma County Airport Station at their regularly scheduled times.",
    severity: "warning",
    startsAt: "2025-06-23",
    endsAt: "2025-07-23",
    active: true,
    fingerprint: buildAlertFingerprint({
      id: "2025-06-23-windsor-temp-suspension",
      title: "Service Alert",
      message:
        "Effective Monday, June 23, 2025, the first three Southbound weekday trips departing from Windsor are temporarily suspended. These trips will depart from Sonoma County Airport Station at their regularly scheduled times.",
      startsAt: "2025-06-23",
      endsAt: "2025-07-23",
    }),
  },
];

export default serviceAlerts;

