import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  
  // Normalize language to base code (e.g., "es-MX" -> "es")
  const currentLang = i18n.language?.split("-")[0] || "en";

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
          onValueChange={(value) => {
            // Normalize to base language code (i18next will save to localStorage via LanguageDetector)
            const normalizedLang = value.split("-")[0];
            i18n.changeLanguage(normalizedLang);
          }}
        >
          <DropdownMenuRadioItem
            value="en"
            className="data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
          >
            <span>{t("language.english")}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="es"
            className="data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
          >
            <span>{t("language.spanish")}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
