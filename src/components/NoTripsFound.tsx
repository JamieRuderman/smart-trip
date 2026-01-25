import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

export function NoTripsFound() {
  const { t } = useTranslation();

  return (
    <Card
      className="text-center py-8 max-w-4xl mx-auto"
      role="status"
      aria-live="polite"
    >
      <CardContent>
        <p className="text-muted-foreground">{t("noTripsFound.noTrainsFound")}</p>
      </CardContent>
    </Card>
  );
}
