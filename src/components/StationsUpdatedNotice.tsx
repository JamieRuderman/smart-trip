import { useEffect, useRef } from "react";
import type { Station } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";

/** How long the notice stays up before closing itself. */
const AUTO_CLOSE_MS = 3000;

interface StationsUpdatedNoticeProps {
  fromStation: Station;
  toStation: Station;
  /** Closed — by OK, dismissal, or the auto-close timer. */
  onClose: () => void;
}

/**
 * Shown when the location warning's fix switches the stations but there's no
 * train it can take on the new trip: says what changed and to pick a time to
 * leave, then closes itself.
 */
export function StationsUpdatedNotice({
  fromStation,
  toStation,
  onClose,
}: StationsUpdatedNoticeProps) {
  const { t } = useTranslation();

  // The timer runs once from when the notice opens; parent re-renders hand us
  // a fresh onClose, which must not restart it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => onCloseRef.current(), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ConfirmDialog
      title={t("boardingCheck.updatedTitle")}
      description={t("boardingCheck.updatedBody", { from: fromStation, to: toStation })}
      primaryLabel={t("boardingCheck.updatedOk")}
      onPrimary={onClose}
      onDismiss={onClose}
    />
  );
}
