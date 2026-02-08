import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { getSystemLanguage } from "@/lib/capacitorLanguageDetector";

export function LanguageToggle() {
  const { i18n, t } = useTranslation();

  const hasStoredLanguage =
    typeof window !== "undefined" && !!window.localStorage?.getItem("smart-train-language");

  // Normalize language to base code (e.g., "es-MX" -> "es")
  const currentLang = hasStoredLanguage ? i18n.language?.split("-")[0] || "en" : "system";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Globe className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("language.toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={currentLang}
          onValueChange={async (value) => {
            if (value === "system") {
              if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.removeItem("smart-train-language");
              }
              const systemLang = await getSystemLanguage();
              i18n.changeLanguage(systemLang);
              return;
            }

            // Normalize to base language code
            const normalizedLang = value.split("-")[0];

            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.setItem("smart-train-language", normalizedLang);
            }

            // Change language (i18next won't auto-cache since caches: [])
            i18n.changeLanguage(normalizedLang);
          }}
        >
          <DropdownMenuRadioItem value="system">
            <span>{t("language.system")}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="en">
            <span>{t("language.english")}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="es">
            <span>{t("language.spanish")}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
