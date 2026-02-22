import { Bell } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useTranslation } from "react-i18next";

export function BottomInfoBar() {
  const { t } = useTranslation();

  return (
    <div className="container max-w-4xl mx-auto px-3 md:px-0 pb-safe space-y-3">
      <div className="pt-12 mt-6 md:px-8 md:py-4 text-sm text-muted-foreground border-t md:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Bell className="h-4 w-4 mt-0.5 shrink-0 text-foreground/70" />
            <p className="text-sm">
              {t("bottomInfo.alertSignupText")}{" "}
              <span className="font-semibold">SMART</span>{" "}
              {t("bottomInfo.alertSignupTo")}{" "}
              <span className="font-semibold">888777</span>
              {", "}
              {t("bottomInfo.alertSignupOr")}{" "}
              <a
                href="https://member.everbridge.net/index/892807736728379#/login"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t("bottomInfo.alertSignupLink")}
              </a>
              .
            </p>
          </div>
          <div className="-mb-4 flex items-center gap-2 shrink-0">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <p className="ml-6 mt-3 text-xs">
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
