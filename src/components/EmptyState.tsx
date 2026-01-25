import { Card, CardContent } from "@/components/ui/card";
import { TripIcon } from "@/components/icons/TripIcon";
import { useTranslation } from "react-i18next";

export function EmptyState() {
  const { t } = useTranslation();

  return (
    <Card
      className="flex flex-col justify-center container mx-auto flex-grow text-center max-w-4xl border-0 shadow-none"
      role="status"
      aria-live="polite"
    >
      <CardContent className="flex flex-col items-center gap-4 pb-0 pt-4">
        <TripIcon
          className="h-8 w-8 text-primary"
          aria-hidden="true"
          strokeWidth={1.5}
        />
        <h2 className="text-xl font-semibold">{t("emptyState.selectYourRoute")}</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          {t("emptyState.chooseStations")}
        </p>
      </CardContent>
    </Card>
  );
}
