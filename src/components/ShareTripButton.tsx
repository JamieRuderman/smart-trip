import { useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Share as ShareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScheduleType } from "@/data/trainSchedules";
import { legPlaces } from "@/lib/places";
import { formatSharedServiceDate, sharedTripUrl } from "@/lib/sharedTrip";
import { tripEnds, type ProcessedTrip } from "@/lib/scheduleUtils";
import { cn } from "@/lib/utils";
import { formatTime } from "./TimeDisplay";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

interface ShareTripButtonProps {
  trip: ProcessedTrip;
  serviceDate: string;
  scheduleType: ScheduleType;
  timeFormat: "12h" | "24h";
  className?: string;
}

export function ShareTripButton({
  trip, serviceDate, scheduleType, timeFormat, className,
}: ShareTripButtonProps) {
  const { t, i18n } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const sharing = useRef(false);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");

  const share = async () => {
    if (sharing.current) return;
    sharing.current = true;
    setCopyState("idle");
    const native = Capacitor.isNativePlatform();
    const previewOrigin = import.meta.env.DEV && !native ? window.location.origin : undefined;
    const url = sharedTripUrl(trip, scheduleType, serviceDate, previewOrigin).href;
    const { start, end } = tripEnds(trip);
    const viaFerry = !!(trip.inboundFerry || trip.outboundFerry);
    const { from, to } = legPlaces(trip.fromStation, trip.toStation, viaFerry);
    const title = t("shareTrip.title");
    const text = t("shareTrip.message", {
      from,
      to,
      date: formatSharedServiceDate(serviceDate, i18n.language),
      departure: formatTime(start, timeFormat),
      arrival: formatTime(end, timeFormat),
      service: t(viaFerry ? "shareTrip.trainAndFerry" : "shareTrip.train", { train: trip.trip }),
    });
    try {
      const data = { title, text, url };
      if (native) {
        await Share.share({ ...data, dialogTitle: t("shareTrip.share") });
      } else if (typeof navigator.share === "function" && (navigator.canShare?.(data) ?? true)) {
        await navigator.share(data);
      } else {
        setFallbackUrl(url);
      }
    } catch (error) {
      if (!(error instanceof Error && (error.name === "AbortError" || error.message === "Share canceled"))) {
        setFallbackUrl(url);
      }
    } finally {
      sharing.current = false;
    }
  };

  const copyLink = async () => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(fallbackUrl);
        setCopyState("copied");
        return;
      } catch {
        // Some embedded browsers expose the API but deny clipboard writes.
      }
    }

    const input = linkInput.current;
    input?.focus();
    input?.select();
    try {
      // The selection-based command also works on many HTTP previews.
      if (input && document.execCommand("copy")) {
        setCopyState("copied");
        return;
      }
    } catch {
      // Keep the link selected so the browser's own copy command is available.
    }
    setCopyState("manual");
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("shareTrip.share")}
        title={t("shareTrip.share")}
        onClick={() => void share()}
        className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <ShareIcon className="size-5" aria-hidden="true" />
      </button>
      {fallbackUrl && (
        <Dialog open onOpenChange={(open) => { if (!open) setFallbackUrl(""); }}>
          <DialogContent
            className="w-[calc(100%-2rem)] max-w-sm"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              button.current?.focus();
            }}
          >
            <DialogTitle>{t("shareTrip.share")}</DialogTitle>
            <DialogDescription>{t("shareTrip.copyDescription")}</DialogDescription>
            <input
              ref={linkInput}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              aria-label={t("shareTrip.link")}
              readOnly
              value={fallbackUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button onClick={() => void copyLink()}>
              {t(copyState === "copied" ? "shareTrip.copied" : "shareTrip.copy")}
            </Button>
            <p role="status" className={copyState === "manual" ? "text-sm text-muted-foreground" : "sr-only"}>
              {copyState === "manual" ? t("shareTrip.copyManually") : copyState === "copied" ? t("shareTrip.copied") : ""}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
