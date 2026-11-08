import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpDown,
  MapPin,
  CornerDownRight,
  CornerUpRight,
  Ship,
  LocateFixed,
  Loader2,
} from "lucide-react";
import { getAllStations, getStationIndex } from "@/lib/stationUtils";
import { SAN_FRANCISCO, placeStation, type Place } from "@/lib/places";
import type { Station } from "@/types/smartSchedule";
import { PillBadge } from "./PillBadge";
import { useTranslation } from "react-i18next";

export type StationSelectorProps = {
  fromStation: Place | "";
  toStation: Place | "";
  onFromStationChange: (place: Place) => void;
  onToStationChange: (place: Place) => void;
  onSwapStations: () => void;
  closestStation?: Station | null;
  locationLoading?: boolean;
  onRequestLocation?: () => void;
};

const PlaceName = ({ place }: { place: Place }) => (
  <div className="flex items-center gap-2">
    <span>{place}</span>
    {place === SAN_FRANCISCO && <Ship className="h-4 w-4" aria-hidden="true" />}
  </div>
);

const PlaceSelectItem = ({
  place,
  ferryHint,
  badge,
  gutterIcon,
  ...props
}: {
  place: Place;
  /** Subtitle under San Francisco. */
  ferryHint: string;
  badge?: React.ReactNode;
  gutterIcon?: React.ReactNode;
} & Omit<React.ComponentProps<typeof SelectItem>, "value">) => (
  <SelectItem value={place} {...props}>
    {gutterIcon && (
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {gutterIcon}
      </span>
    )}
    <div className="flex items-center w-full">
      {place === SAN_FRANCISCO ? (
        <span className="flex flex-col">
          <PlaceName place={place} />
          <span className="text-xs text-muted-foreground">{ferryHint}</span>
        </span>
      ) : (
        <span>{place}</span>
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
  closestStation,
  locationLoading,
  onRequestLocation,
}: StationSelectorProps) {
  // Show location button whenever a handler is provided — on all platforms
  const showLocationButton = !!onRequestLocation;
  const { t } = useTranslation();
  const places: Place[] = getAllStations();
  const ferryHint = t("header.viaLarkspurFerry");
  const lineIndex = (place: Place | "") =>
    place ? getStationIndex(placeStation(place)) : -1;

  const item = (
    place: Place,
    other: Place | "",
    otherLabel: string,
    otherIcon: React.ReactNode,
  ) => (
    <PlaceSelectItem
      key={place}
      place={place}
      ferryHint={ferryHint}
      role="option"
      className={place === other ? "text-primary" : ""}
      gutterIcon={place === other ? otherIcon : undefined}
      badge={
        <>
          {place === other && (
            <PillBadge label={otherLabel} color="ontime" className="ml-2" />
          )}
          {place === closestStation && (
            <PillBadge
              label={t("header.nearYou")}
              color="ontime"
              className="ml-2"
            />
          )}
        </>
      }
    />
  );

  const fromItem = (place: Place) =>
    item(
      place,
      toStation,
      t("header.endStation"),
      lineIndex(toStation) > lineIndex(fromStation) ? (
        <CornerDownRight
          className="mt-1 ml-1 h-3 w-3 flex-shrink-0"
          style={{ strokeWidth: 3 }}
        />
      ) : (
        <CornerUpRight
          className="mt-2 ml-1 h-3 w-3 flex-shrink-0"
          style={{ strokeWidth: 3 }}
        />
      ),
    );

  const toItem = (place: Place) =>
    item(
      place,
      fromStation,
      t("header.startStation"),
      <MapPin className="mt-1 ml-1.5 h-5 w-5 mr-1.5 flex-shrink-0" />,
    );

  return (
    <div className="flex items-center gap-3 mb-2">
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
      <div className="flex-1 min-w-0 space-y-3">
        <Select value={fromStation} onValueChange={onFromStationChange}>
          <SelectTrigger
            className="h-11"
            aria-label={t("header.selectDepartureStation")}
          >
            {fromStation ? (
              <PlaceName place={fromStation} />
            ) : (
              <SelectValue placeholder={t("header.departure")} />
            )}
          </SelectTrigger>
          <SelectContent
            role="listbox"
            aria-label={t("header.availableStations")}
          >
            {places.map(fromItem)}
            <SelectSeparator />
            {fromItem(SAN_FRANCISCO)}
          </SelectContent>
        </Select>

        <Select value={toStation} onValueChange={onToStationChange}>
          <SelectTrigger
            className="h-11"
            aria-label={t("header.selectArrivalStation")}
          >
            {toStation ? (
              <PlaceName place={toStation} />
            ) : (
              <SelectValue placeholder={t("header.destination")} />
            )}
          </SelectTrigger>
          <SelectContent
            role="listbox"
            aria-label={t("header.availableStations")}
          >
            {places.map(toItem)}
            <SelectSeparator />
            {toItem(SAN_FRANCISCO)}
          </SelectContent>
        </Select>
      </div>

      {/* Right column: location button (top) + swap button (bottom) */}
      <div className="flex flex-col justify-between self-stretch shrink-0 gap-3">
        {showLocationButton && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            onClick={onRequestLocation}
            disabled={locationLoading}
            aria-label={t("header.useMyLocation")}
            title={t("header.useMyLocation")}
          >
            {locationLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={onSwapStations}
          className="h-11 w-11"
          disabled={!fromStation || !toStation}
          aria-label={t("header.swapStations")}
          title={t("header.swapStations")}
        >
          <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
