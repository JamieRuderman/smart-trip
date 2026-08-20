import { Capacitor } from "@capacitor/core";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { ScheduleFreshnessLabel } from "./ScheduleFreshnessLabel";
import { useTranslation } from "react-i18next";
import { APP_STORE_URL } from "@/seo/constants";

export function BottomInfoBar() {
  const { t } = useTranslation();

  // Web-only prompt: inside the native app there's nothing to download.
  const showAppPrompt = !Capacitor.isNativePlatform();

  return (
    <div className="container max-w-4xl mx-auto px-3 md:px-0 pb-safe space-y-3">
      <div className="pt-12 mt-6 md:px-8 md:py-4 text-sm text-muted-foreground border-t md:border-t-0">
        <div className="flex items-start justify-between gap-3">
          {showAppPrompt ? (
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block hover:opacity-90 transition"
            >
              <img
                src="/badges/app-store-en.svg"
                alt={t("seo.cta.ios.appStore")}
                width={120}
                height={40}
                className="h-10 w-auto block"
              />
            </a>
          ) : (
            <div />
          )}
          <div className="-mb-4 flex items-center gap-2 shrink-0">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <p className="mt-3 text-xs">
          {t("bottomInfo.dataProvidedBy")}{" "}
          <a
            href="https://511.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            511.org
          </a>
          . {t("bottomInfo.communityProject")}
        </p>
        <ScheduleFreshnessLabel className="mt-2" />
        <p className="mt-2 text-xs">
          {t("bottomInfo.linksIntro")}{" "}
          <a
            href="/support.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            {t("bottomInfo.supportLink")}
          </a>{" "}
          ·{" "}
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            {t("bottomInfo.privacyHostedLink")}
          </a>
        </p>
      </div>
    </div>
  );
}

export default BottomInfoBar;
