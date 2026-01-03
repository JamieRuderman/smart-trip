import { memo, useRef } from "react";
import smartLogo from "@/assets/smart-logo.svg";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowUpDown,
  MapPin,
  Calendar,
  CornerDownRight,
  Ship,
  HeartHandshake,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAllStations, hasFerryConnection } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";
import {
  useResponsiveHeaderHeights,
  useStickyHeaderCollapse,
} from "@/hooks/useHeaderHeights";
import { ShrinkingContainer } from "./ShrinkingContainer";

interface StickyHeaderProps {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  onFromStationChange: (station: Station) => void;
  onToStationChange: (station: Station) => void;
  onScheduleTypeChange: (type: "weekday" | "weekend") => void;
  onSwapStations: () => void;
}

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
  ...props
}: {
  station: string;
  direction: "southbound" | "northbound";
} & React.ComponentProps<typeof SelectItem>) => (
  <SelectItem {...props}>
    <div className="flex items-center justify-between w-full">
      <span>{station}</span>
      {hasFerryConnection(station) && (
        <>
          <span className="text-muted-foreground ml-2">
            {direction === "southbound" ? "←" : "→"}
          </span>
          <Ship className="h-4 w-4 ml-2" />
        </>
      )}
    </div>
  </SelectItem>
);

export const StickyHeader = memo(function StickyHeader({
  fromStation,
  toStation,
  scheduleType,
  onFromStationChange,
  onToStationChange,
  onScheduleTypeChange,
  onSwapStations,
}: StickyHeaderProps) {
  const stations = getAllStations();
  const headerRef = useRef<HTMLDivElement>(null);
  const headerHeights = useResponsiveHeaderHeights();
  useStickyHeaderCollapse(headerRef, headerHeights);

  return (
    <div
      className="sticky top-0 z-50"
      ref={headerRef}
      style={{ overflowAnchor: "none" }}
    >
      {/* Logo Header */}
      <header
        className="bg-smart-train-green container max-w-screen-xl mx-auto px-4 pt-safe flex flex-col items-center"
        role="banner"
      >
        <ShrinkingContainer
          heightVar="--header-logo-height"
          maxHeight={headerHeights.logo}
        >
          <img
            src={smartLogo}
            alt="Sonoma-Marin Area Rail Transit Logo"
            className="h-auto w-64 sm:w-96 max-w-full mb-3"
          />
          <h1 className="sr-only">SMART Train Schedule Application</h1>
        </ShrinkingContainer>
      </header>

      {/* Route Selector with layered background */}
      <div className="container mx-auto px-4 max-w-screen-xl relative">
        <div
          className="absolute inset-x-0 top-0 h-[50%] bg-smart-train-green xl:rounded-b-[2rem] pointer-events-none"
          aria-hidden="true"
        />
        {/* Single Route Selector */}
        <Card className="max-w-4xl mx-auto relative z-1 shadow-md">
          <CardHeader className="px-5 py-2">
            <ShrinkingContainer
              heightVar="--header-title-height"
              maxHeight={headerHeights.title}
            >
              <CardTitle
                id="route-planning-title"
                className="flex flex-wrap items-center justify-between my-2"
              >
                Plan Your Journey
                <a
                  href="https://github.com/JamieRuderman/smart-train-schedule"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Community app on GitHub"
                >
                  <Badge
                    variant="subtle"
                    className="gap-1 tracking-normal font-normal text-foreground/70 hover:bg-muted/70"
                  >
                    <HeartHandshake
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    Community App
                  </Badge>
                </a>
              </CardTitle>
            </ShrinkingContainer>
          </CardHeader>
          <CardContent className="px-5 pb-2">
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
                    <Select
                      value={fromStation}
                      onValueChange={onFromStationChange}
                    >
                      <SelectTrigger
                        className="h-11"
                        aria-label="Select departure station"
                      >
                        {fromStation ? (
                          <StationWithFerry
                            station={fromStation}
                            direction="southbound"
                          />
                        ) : (
                          <SelectValue placeholder="Your location" />
                        )}
                      </SelectTrigger>
                      <SelectContent
                        role="listbox"
                        aria-label="Available stations"
                      >
                        {stations.map((station) => (
                          <StationSelectItem
                            key={station}
                            station={station}
                            value={station}
                            role="option"
                            direction="southbound"
                          />
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Select value={toStation} onValueChange={onToStationChange}>
                      <SelectTrigger
                        className="h-11"
                        aria-label="Select arrival station"
                      >
                        {toStation ? (
                          <StationWithFerry
                            station={toStation}
                            direction="northbound"
                          />
                        ) : (
                          <SelectValue placeholder="Destination" />
                        )}
                      </SelectTrigger>
                      <SelectContent
                        role="listbox"
                        aria-label="Available stations"
                      >
                        {stations
                          .filter((station) => station !== fromStation)
                          .map((station) => (
                            <StationSelectItem
                              key={station}
                              station={station}
                              value={station}
                              role="option"
                              direction="northbound"
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
                aria-label="Swap departure and arrival stations"
                title="Swap departure and arrival stations"
              >
                <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            {/* Schedule Type Tabs */}
            <ShrinkingContainer
              heightVar="--header-tabs-height"
              maxHeight={headerHeights.tabs}
            >
              <Tabs
                value={scheduleType}
                onValueChange={onScheduleTypeChange}
                aria-label="Select schedule type"
                className="py-2"
              >
                <TabsList className="grid grid-cols-2 w-full" role="tablist">
                  <TabsTrigger
                    value="weekday"
                    className="flex items-center gap-2"
                    aria-label="Weekday schedule"
                  >
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    Weekday
                  </TabsTrigger>
                  <TabsTrigger
                    value="weekend"
                    className="flex items-center gap-2"
                    aria-label="Weekend and holiday schedule"
                  >
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    Weekend
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </ShrinkingContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});
