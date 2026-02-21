import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertCircle, Bell, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { AppNotification } from "@/types/notifications";

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  readIds: Set<string>;
  unreadCount: number;
  isLoading: boolean;
  onMarkAllRead: () => void;
}

const SEVERITY_CLASSES: Record<AppNotification["severity"], string> = {
  critical: "text-destructive",
  warning: "text-smart-gold",
  info: "text-muted-foreground",
};

export function NotificationPanel({
  isOpen,
  onClose,
  notifications,
  readIds,
  unreadCount,
  isLoading,
  onMarkAllRead,
}: NotificationPanelProps) {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-sm",
            "bg-background border-l shadow-xl",
            "flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("notifications.title")}
          </DialogPrimitive.Title>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-foreground/70" />
              <span className="font-semibold text-base">
                {t("notifications.title")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                  onClick={onMarkAllRead}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t("notifications.markAllRead")}
                </Button>
              )}
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label={t("notifications.close")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && notifications.length === 0 ? (
              <div className="flex flex-col gap-3 p-4">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">{t("notifications.noAlerts")}</p>
              </div>
            ) : (
              <ul className="divide-y">
                {notifications.map((notification) => {
                  const isUnread = !readIds.has(notification.id);
                  return (
                    <li
                      key={notification.id}
                      className={cn(
                        "px-4 py-4 flex items-start gap-3",
                        isUnread && "bg-smart-gold/5"
                      )}
                    >
                      <AlertCircle
                        className={cn(
                          "h-4 w-4 mt-0.5 flex-shrink-0",
                          SEVERITY_CLASSES[notification.severity]
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              "text-sm font-medium",
                              SEVERITY_CLASSES[notification.severity]
                            )}
                          >
                            {notification.title}
                          </p>
                          {isUnread && (
                            <span className="h-2 w-2 rounded-full bg-smart-gold flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {notification.message}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
