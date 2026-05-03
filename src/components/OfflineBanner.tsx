import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Persistent banner shown when the device reports `navigator.onLine === false`.
 * Sits at the top of the main content (above service alerts) so it can't be
 * scrolled past — once the network returns the banner disappears on its own.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-lg border border-muted-foreground/30 bg-muted/40 px-4 py-3 text-sm"
    >
      <WifiOff
        className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground">
          {t("freshness.offlineBannerTitle")}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("freshness.offlineBannerMessage")}
        </p>
      </div>
    </div>
  );
}
