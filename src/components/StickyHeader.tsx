import { memo } from "react";
import smartLogo from "@/assets/smart-logo.svg";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, HeartHandshake } from "lucide-react";
import type { Station } from "@/types/smartSchedule";
import { type HeaderHeights } from "@/hooks/useHeaderHeights";
import { ShrinkingContainer } from "./ShrinkingContainer";
import { StationSelector } from "./StationSelector";
import { useTranslation } from "react-i18next";

export type StickyHeaderProps = {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  headerHeights: HeaderHeights;
  onFromStationChange: (station: Station) => void;
  onToStationChange: (station: Station) => void;
  onScheduleTypeChange: (type: "weekday" | "weekend") => void;
  onSwapStations: () => void;
};

export const StickyHeader = memo(function StickyHeader({
  fromStation,
  toStation,
  scheduleType,
  headerHeights,
  onFromStationChange,
  onToStationChange,
  onScheduleTypeChange,
  onSwapStations,
}: StickyHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-x-0 top-0 z-50"
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
                {t("header.planYourTrip")}
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
                    {t("header.communityApp")}
                  </Badge>
                </a>
              </CardTitle>
            </ShrinkingContainer>
          </CardHeader>
          <CardContent className="px-5 pb-2">
            <StationSelector
              fromStation={fromStation}
              toStation={toStation}
              onFromStationChange={onFromStationChange}
              onToStationChange={onToStationChange}
              onSwapStations={onSwapStations}
            />

            {/* Schedule Type Tabs */}
            <ShrinkingContainer
              heightVar="--header-tabs-height"
              maxHeight={headerHeights.tabs}
            >
              <Tabs
                value={scheduleType}
                onValueChange={onScheduleTypeChange}
                aria-label={t("header.selectScheduleType")}
                className="py-2"
              >
                <TabsList className="grid grid-cols-2 w-full" role="tablist">
                  <TabsTrigger
                    value="weekday"
                    className="flex items-center gap-2"
                    aria-label={t("header.weekdaySchedule")}
                  >
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    {t("header.weekday")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="weekend"
                    className="flex items-center gap-2"
                    aria-label={t("header.weekendSchedule")}
                  >
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    {t("header.weekend")}
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
