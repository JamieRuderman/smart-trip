import { CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { calculateFare, getAllFareOptions } from "@/lib/scheduleUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { FARE_CONSTANTS, FERRY_CONSTANTS, FERRY_FARE_PARAMS } from "@/lib/fareConstants";
import { isFerryLeg, placeStation, type Place } from "@/lib/places";
import type { FareType } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

interface FareSectionProps {
  from: Place;
  to: Place;
}

const linkClass =
  "text-foreground underline-offset-2 hover:underline hover:text-primary transition-colors";

export function FareSection({ from, to }: FareSectionProps) {
  const { preferences, updateSelectedFareType } = useUserPreferences();
  const { t } = useTranslation();
  const selectedFareType = preferences.selectedFareType;

  const viaFerry = isFerryLeg(from, to);
  const fromStation = placeStation(from);
  const toStation = placeStation(to);
  if (fromStation === toStation) return null;

  const getFareDescription = (fareType: FareType): string => {
    const riderLabels = viaFerry ? "fare.ferry" : "fare";
    const keyMap: Record<FareType, string> = {
      adult: "fare.adult",
      youth: `${riderLabels}.youth`,
      senior: `${riderLabels}.senior`,
      disabled: `${riderLabels}.disabled`,
      "clipper-start": "fare.clipperStart",
    };
    return t(keyMap[fareType]);
  };

  const formatPrice = (price: number): string =>
    price === 0 ? t("common.free") : `$${price.toFixed(2)}`;

  const fareOptions = getAllFareOptions(fromStation, toStation, viaFerry);
  const currentFare =
    selectedFareType !== "none"
      ? calculateFare(fromStation, toStation, selectedFareType, viaFerry)
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
                    • {from} → {to}
                  </p>
                  {currentFare.ferryPrice != null && (
                    <p className="text-sm text-muted-foreground">
                      {t("fare.trainPlusFerry", {
                        train: formatPrice(currentFare.trainPrice),
                        ferry: formatPrice(currentFare.ferryPrice),
                      })}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    {formatPrice(currentFare.price)}
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
                  {formatPrice(option.price)}
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
          {viaFerry && (
            <>
              <p>
                •{" "}
                {t("fare.ferryFares", FERRY_FARE_PARAMS)}
              </p>
              <p>• {t("fare.transferDiscount")}</p>
            </>
          )}
          <p>
            • {t("fare.paymentOptions")}{" "}
            <a
              href="https://sonomamarintrain.org"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              sonomamarintrain.org
            </a>
            {viaFerry && (
              <>
                {" "}
                {t("fare.and")}{" "}
                <a
                  href={FERRY_CONSTANTS.FARES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  goldengate.org
                </a>
              </>
            )}
          </p>
        </div>
      </CardContent>
    </SectionCard>
  );
}
