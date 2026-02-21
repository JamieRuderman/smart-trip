export interface AppNotification {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  sourceType: "service-alert";
}
