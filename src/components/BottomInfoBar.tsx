import { Bell } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useTranslation } from "react-i18next";

interface BottomInfoBarProps {
  unreadCount: number;
  onOpenNotifications: () => void;
}

export function BottomInfoBar({ unreadCount, onOpenNotifications }: BottomInfoBarProps) {
  const { t } = useTranslation();

  return (
    <div className="container max-w-4xl mx-auto px-3 md:px-0 pb-safe space-y-3">
      <div className="pt-12 mt-6 md:px-8 md:py-4 text-sm text-muted-foreground border-t md:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={onOpenNotifications}
            className="relative flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
            aria-label={
              unreadCount > 0
                ? t("notifications.openWithCount", { count: unreadCount })
                : t("notifications.open")
            }
          >
            <span className="relative shrink-0">
              <Bell className="h-4 w-4 mt-0.5 text-foreground/70" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-smart-gold text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            <span>
              {unreadCount > 0
                ? t("notifications.alertsUnread", { count: unreadCount })
                : t("notifications.serviceAlerts")}
            </span>
          </button>
          <div className="-mb-4 flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <p className="ml-7 mt-4 text-xs">
          {t("bottomInfo.dataProvidedBy")}{" "}
          <a
            href="https://511.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            511.org
          </a>
          . {t("bottomInfo.communityProject")}
        </p>
      </div>
    </div>
  );
}

export default BottomInfoBar;
