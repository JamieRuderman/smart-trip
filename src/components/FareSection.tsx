import { CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { calculateFare, getAllFareOptions } from "@/lib/scheduleUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { FARE_CONSTANTS } from "@/lib/fareConstants";
import type { Station, FareType } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

interface FareSectionProps {
  fromStation: Station | "";
  toStation: Station | "";
}

export function FareSection({ fromStation, toStation }: FareSectionProps) {
  const { preferences, updateSelectedFareType } = useUserPreferences();
  const { t } = useTranslation();
  const selectedFareType = preferences.selectedFareType;

  const getFareDescription = (fareType: FareType): string => {
    const keyMap: Record<FareType, string> = {
      adult: "fare.adult",
      youth: "fare.youth",
      senior: "fare.senior",
      disabled: "fare.disabled",
      "clipper-start": "fare.clipperStart",
    };
    return t(keyMap[fareType]);
  };

  // Don't render if stations aren't selected
  if (!fromStation || !toStation) {
    return null;
  }

  const fareOptions = getAllFareOptions(fromStation, toStation);
  const currentFare =
    selectedFareType !== "none"
      ? calculateFare(fromStation, toStation, selectedFareType)
      : null;

  const handleFareSelect = (fareType: FareType) => {
    updateSelectedFareType(fareType);
  };

  const handleClearFare = () => {
    updateSelectedFareType("none");
  };

  return (
    <SectionCard>
      <CardHeader className="p-3 md:p-6 pb-0 md:pb-0">
        <CardTitle className="flex items-center justify-between gap-2">
          {t("fare.fareInformation")}
          {selectedFareType === "none" && (
            <span className="text-sm font-medium text-muted-foreground">
              {t("fare.selectYourFare")}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 p-3 md:p-6">
        {/* Selected Fare Display */}
        {selectedFareType !== "none" && currentFare ? (
          <div className="space-y-4">
            <div className="status-box-primary">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-medium">{getFareDescription(selectedFareType)}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentFare.zones}{" "}
                    {currentFare.zones === 1
                      ? t("common.zone")
                      : t("common.zones")}{" "}
                    • {fromStation} → {toStation}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    {currentFare.price === 0
                      ? t("common.free")
                      : `$${currentFare.price.toFixed(2)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("common.oneWay")}
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFare}
              className="mt-2 w-full"
            >
              {t("fare.showAllFares")}
            </Button>
          </div>
        ) : (
          /* All Fare Options - Clickable Cards */
          <div className="grid gap-2">
            {fareOptions.map((option) => (
              <Button
                key={option.fareType}
                variant="outline"
                onClick={() => handleFareSelect(option.fareType)}
                className="flex justify-between items-center p-4 h-auto rounded-lg border border-border hover:border-primary hover:bg-primary/10 hover:shadow-sm transition-all duration-200 text-left w-full group"
              >
                <span className="text-sm font-medium group-hover:text-primary transition-colors">
                  {getFareDescription(option.fareType)}
                </span>
                <span className="font-semibold text-lg group-hover:text-primary transition-colors">
                  {option.price === 0
                    ? t("common.free")
                    : `$${option.price.toFixed(2)}`}
                </span>
              </Button>
            ))}
          </div>
        )}

        {/* Additional Info */}
        <div className="text-xs text-muted-foreground py-2">
          <p>
            •{" "}
            {t("fare.faresZoneBased", {
              price: FARE_CONSTANTS.ADULT_FARE_PER_ZONE.toFixed(2),
            })}
          </p>
          <p>• {t("fare.youthSeniorsFree")}</p>
          <p>• {t("fare.discountsAvailable")}</p>
          <p>
            • {t("fare.paymentOptions")}{" "}
            <a
              href="https://sonomamarintrain.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              sonomamarintrain.org
            </a>
          </p>
        </div>
      </CardContent>
    </SectionCard>
  );
}
