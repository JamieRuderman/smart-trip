import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FlaskConical, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { openFeedbackEmail } from "@/lib/feedback";

type Variant = "tester" | "recruit";

const DISMISS_KEY = "smart-train-android-beta-dismissed";

function detectVariant(): Variant | null {
  if (Capacitor.getPlatform() === "android") return "tester";
  if (!Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent)) return "recruit";
  return null;
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Storage can be unavailable (private mode); the card just reappears next visit.
  }
}

export function AndroidBetaCard() {
  const { t, i18n } = useTranslation();
  const [variant, setVariant] = useState<Variant | null>(() =>
    isDismissed() ? null : detectVariant(),
  );

  if (!variant) return null;

  const dismiss = () => {
    rememberDismissed();
    setVariant(null);
  };

  return (
    <SectionCard className="overflow-hidden bg-smart-train-green/5">
      <div className="w-full px-5 py-4 md:px-6 flex items-start justify-between gap-2 text-smart-train-green">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <FlaskConical className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{t(`androidBeta.${variant}Title`)}</div>
            <p className="text-xs mt-1 text-smart-train-green/80">{t(`androidBeta.${variant}Body`)}</p>
            {variant === "tester" ? (
              <button
                type="button"
                onClick={() => void openFeedbackEmail(i18n.language)}
                className="mt-2 text-sm font-semibold underline underline-offset-2"
              >
                {t("androidBeta.sendFeedback")}
              </button>
            ) : (
              <a
                href="/android-beta.html"
                className="mt-2 inline-block text-sm font-semibold underline underline-offset-2"
              >
                {t("androidBeta.joinBeta")}
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("androidBeta.dismiss")}
          onClick={dismiss}
          className="shrink-0 -mr-2 -mt-2 p-3 rounded-lg hover:bg-smart-train-green/10 active:bg-smart-train-green/20 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </SectionCard>
  );
}
