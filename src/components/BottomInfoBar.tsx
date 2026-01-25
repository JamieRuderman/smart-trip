import { Bell } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useTranslation, Trans } from "react-i18next";

export function BottomInfoBar() {
  const { t } = useTranslation();

  return (
    <div className="container max-w-4xl mx-auto px-3 md:px-0 pb-safe space-y-3">
      <div className="pt-12 mt-6 md:px-8 md:py-4 text-sm text-muted-foreground border-t md:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <Bell
            aria-hidden
            className="h-4 w-4 mt-0.5 shrink-0 text-foreground/70"
          />
          <p className="flex-grow">
            <Trans
              i18nKey="bottomInfo.receiveAlerts"
              components={{
                strong: <span className="font-semibold" />,
                link: (
                  <a
                    href="https://member.everbridge.net/index/892807736728379#/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {/* Content will be inserted here by Trans */}
                  </a>
                ),
              }}
            />
          </p>
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
