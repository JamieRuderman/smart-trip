import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpDown,
  MapPin,
  CornerDownRight,
  CornerUpRight,
  Ship,
} from "lucide-react";
import { getAllStations, hasFerryConnection } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";
import { PillBadge } from "./PillBadge";
import { useTranslation } from "react-i18next";

export type StationSelectorProps = {
  fromStation: Station | "";
  toStation: Station | "";
  onFromStationChange: (station: Station) => void;
  onToStationChange: (station: Station) => void;
  onSwapStations: () => void;
};

// Reusable component for displaying station name with ferry icon
const StationWithFerry = ({
  station,
  direction,
}: {
  station: string;
  direction: "southbound" | "northbound";
}) => (
  <div className="flex items-center gap-2">
    <span>{station}</span>
    {hasFerryConnection(station) && (
      <>
        <span className="text-muted-foreground">
          {direction === "southbound" ? "←" : "→"}
        </span>
        <Ship className="h-4 w-4 ml-1" />
      </>
    )}
  </div>
);

// Custom SelectItem that handles ferry stations properly
const StationSelectItem = ({
  station,
  direction,
  badge,
  gutterIcon,
  ...props
}: {
  station: string;
  direction: "southbound" | "northbound";
  badge?: React.ReactNode;
  gutterIcon?: React.ReactNode;
} & React.ComponentProps<typeof SelectItem>) => (
  <SelectItem {...props}>
    {gutterIcon && (
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {gutterIcon}
      </span>
    )}
    <div className="flex items-center w-full">
      <span>{station}</span>
      {hasFerryConnection(station) && (
        <>
          <span className="text-muted-foreground ml-2">
            {direction === "southbound" ? "←" : "→"}
          </span>
          <Ship className="h-4 w-4 ml-2" />
        </>
      )}
      {badge}
    </div>
  </SelectItem>
);

export function StationSelector({
  fromStation,
  toStation,
  onFromStationChange,
  onToStationChange,
  onSwapStations,
}: StationSelectorProps) {
  const { t } = useTranslation();
  const stations = getAllStations();

  // Clear the other station if it's selected in this dropdown
  const handleFromStationChange = (station: Station) => {
    onFromStationChange(station);
    if (station === toStation) {
      onToStationChange("" as Station);
    }
  };

  const handleToStationChange = (station: Station) => {
    onToStationChange(station);
    if (station === fromStation) {
      onFromStationChange("" as Station);
    }
  };

  return (
    <div className="flex items-center gap-4 mb-2">
      {/* Visual Indicators */}
      <div className="flex flex-col items-center">
        <MapPin className="h-5 w-5 text-primary fill" />
        <div className="w-px h-6 border-l border-dotted border-muted-foreground my-2"></div>
        <CornerDownRight
          className="h-3 w-3 text-primary ml-2"
          style={{ strokeWidth: 3 }}
        />
      </div>

      {/* Station Selectors */}
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Select value={fromStation} onValueChange={handleFromStationChange}>
              <SelectTrigger
                className="h-11"
                aria-label={t("header.selectDepartureStation")}
              >
                {fromStation ? (
                  <StationWithFerry
                    station={fromStation}
                    direction="southbound"
                  />
                ) : (
                  <SelectValue placeholder={t("header.yourLocation")} />
                )}
              </SelectTrigger>
              <SelectContent
                role="listbox"
                aria-label={t("header.availableStations")}
              >
                {stations.map((station) => (
                  <StationSelectItem
                    key={station}
                    station={station}
                    value={station}
                    role="option"
                    direction="southbound"
                    className={station === toStation ? "text-primary" : ""}
                    gutterIcon={
                      station === toStation ? (
                        stations.indexOf(toStation as Station) >
                        stations.indexOf(fromStation as Station) ? (
                          <CornerDownRight
                            className="mt-1 ml-1 h-3 w-3 flex-shrink-0"
                            style={{ strokeWidth: 3 }}
                          />
                        ) : (
                          <CornerUpRight
                            className="mt-2 ml-1 h-3 w-3 flex-shrink-0"
                            style={{ strokeWidth: 3 }}
                          />
                        )
                      ) : undefined
                    }
                    badge={
                      station === toStation ? (
                        <PillBadge
                          label={t("header.endStation")}
                          color="green"
                          className="ml-2"
                        />
                      ) : undefined
                    }
                  />
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Select value={toStation} onValueChange={handleToStationChange}>
              <SelectTrigger
                className="h-11"
                aria-label={t("header.selectArrivalStation")}
              >
                {toStation ? (
                  <StationWithFerry
                    station={toStation}
                    direction="northbound"
                  />
                ) : (
                  <SelectValue placeholder={t("header.destination")} />
                )}
              </SelectTrigger>
              <SelectContent
                role="listbox"
                aria-label={t("header.availableStations")}
              >
                {stations.map((station) => (
                  <StationSelectItem
                    key={station}
                    station={station}
                    value={station}
                    role="option"
                    direction="northbound"
                    className={station === fromStation ? "text-primary" : ""}
                    gutterIcon={
                      station === fromStation ? (
                        <MapPin className="mt-1 ml-1.5 h-5 w-5 mr-1.5 flex-shrink-0" />
                      ) : undefined
                    }
                    badge={
                      station === fromStation ? (
                        <PillBadge
                          label={t("header.startStation")}
                          color="green"
                          className="ml-2"
                        />
                      ) : undefined
                    }
                  />
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Swap Button */}
      <Button
        variant="outline"
        size="icon"
        onClick={onSwapStations}
        className="shrink-0"
        disabled={!fromStation || !toStation}
        aria-label={t("header.swapStations")}
        title={t("header.swapStations")}
      >
        <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
