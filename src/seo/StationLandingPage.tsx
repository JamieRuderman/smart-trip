// Static landing page template for a single SMART station.
//
// Constraints — non-negotiable for the prerender pipeline:
//   - PURE component: no hooks, no Context, no React Router, no QueryClient
//   - All data is supplied as props by the prerender script
//   - Uses local Card / SectionCard / PillBadge mirrors (src/seo/ui.tsx)
//     that copy the SPA's class strings — visual fidelity without
//     importing across the prerender JSX-runtime boundary
//
// The component is rendered with renderToStaticMarkup; the resulting HTML
// is wrapped in src/seo/shell.ts to produce the final document.

import React from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.
import type { Station } from "@/data/generated/stations.generated";
import {
  STATION_ORDER,
  STATION_ZONES,
} from "@/data/generated/stations.generated";
import {
  trainSchedules,
  type ScheduleType,
} from "@/data/generated/trainSchedules.generated";
import { FARE_CONSTANTS } from "@/lib/fareConstants";
import {
  CardContent,
  CardHeader,
  CardTitle,
  SectionCard,
  PillBadge,
} from "./ui";
import { stationSlug } from "../../scripts/seo/slugify";
import { LANG_PATH_PREFIX, type Lang } from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";
import { Layout } from "./Layout";
import { TripRow } from "./TripRow";

export interface StationLandingPageProps {
  station: Station;
  lang: Lang;
  scheduleGeneratedAt: string;
  smartLogoHref: string;
}

const directionOf = (
  station: Station,
): "north-end" | "south-end" | "middle" => {
  const index = STATION_ORDER.indexOf(station);
  if (index === 0) return "north-end";
  if (index === STATION_ORDER.length - 1) return "south-end";
  return "middle";
};

const neighbors = (station: Station) => {
  const index = STATION_ORDER.indexOf(station);
  return {
    north: index > 0 ? STATION_ORDER[index - 1] : null,
    south: index < STATION_ORDER.length - 1 ? STATION_ORDER[index + 1] : null,
  };
};

const zoneOf = (station: Station): number =>
  STATION_ZONES.find((z) => z.station === station)?.zone ?? 0;

const fareBetween = (fromZone: number, toZone: number): number => {
  const zones = Math.abs(fromZone - toZone) + 1;
  return zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE;
};

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

interface DirectionScheduleProps {
  station: Station;
  type: ScheduleType;
  direction: "northbound" | "southbound";
  lang: Lang;
}

function DirectionSchedule({
  station,
  type,
  direction,
  lang,
}: DirectionScheduleProps) {
  const t = translator(lang);
  const stationIndex = STATION_ORDER.indexOf(station);
  const trips = trainSchedules[type][direction]
    .map((trip) => ({ trip: trip.trip, time: trip.times[stationIndex] }))
    .filter((entry) => Boolean(entry.time));

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
        {t(
          direction === "northbound"
            ? "seo.station.northbound"
            : "seo.station.southbound",
        )}
      </h3>
      {trips.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {t("seo.station.noService")}
        </p>
      ) : (
        <ul className="space-y-1.5 list-none p-0">
          {trips.map(({ trip, time }) => (
            <li key={`${direction}-${trip}`}>
              <TripRow
                tripNumber={trip}
                time={time}
                direction={direction === "northbound" ? "north" : "south"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleCard({
  station,
  type,
  lang,
}: {
  station: Station;
  type: ScheduleType;
  lang: Lang;
}) {
  const t = translator(lang);
  return (
    <SectionCard>
      <CardHeader>
        <CardTitle>
          {t(
            type === "weekday"
              ? "seo.station.weekdayHeading"
              : "seo.station.weekendHeading",
            { station },
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          <DirectionSchedule
            station={station}
            type={type}
            direction="northbound"
            lang={lang}
          />
          <DirectionSchedule
            station={station}
            type={type}
            direction="southbound"
            lang={lang}
          />
        </div>
      </CardContent>
    </SectionCard>
  );
}

export function StationLandingPage({
  station,
  lang,
  scheduleGeneratedAt,
  smartLogoHref,
}: StationLandingPageProps) {
  const t = translator(lang);
  const slug = stationSlug(station);
  const { north, south } = neighbors(station);
  const zone = zoneOf(station);
  const pos = directionOf(station);
  const isLarkspur = station === "Larkspur";

  return (
    <Layout
      lang={lang}
      alternateLangPath={`/stations/${slug}/`}
      scheduleGeneratedAt={scheduleGeneratedAt}
      smartLogoHref={smartLogoHref}
    >
      {/* Breadcrumb — px-6 matches the horizontal padding inside SectionCards
          so non-card content aligns visually with card content below. */}
      <nav aria-label="Breadcrumb" className="text-sm px-6">
        <ol className="flex gap-2 text-muted-foreground">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {t("seo.layout.home")}
            </a>
            <span aria-hidden="true"> /</span>
          </li>
          <li className="text-foreground" aria-current="page">
            {t("seo.station.breadcrumb", { station })}
          </li>
        </ol>
      </nav>

      {/* Title + intro */}
      <section className="space-y-3 px-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t("seo.station.h1", { station })}
          </h1>
          <PillBadge
            label={t("seo.station.zonePill", { zone })}
            color="neutral"
          />
        </div>
        <p className="text-lg text-muted-foreground">
          {t(`seo.station.intro.${pos}`, { station, zone })}
        </p>
      </section>

      {/* Primary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent(station)}`,
          }),
        }}
      />

      {/* Schedules */}
      <ScheduleCard station={station} type="weekday" lang={lang} />
      <ScheduleCard station={station} type="weekend" lang={lang} />

      {/* Fares */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.station.fareHeading", { station })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>{t("seo.station.fareZone", { station, zone })}</p>
          <ul className="space-y-2 list-none p-0">
            {north && (
              <li>
                <a
                  href={linkTo(
                    lang,
                    `/routes/${stationSlug(station)}-to-${stationSlug(north)}/`,
                  )}
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <span>{station} → {north}</span>
                  <PillBadge
                    label={`$${fareBetween(zone, zoneOf(north)).toFixed(2)}`}
                    color="ontime"
                  />
                </a>
              </li>
            )}
            {south && (
              <li>
                <a
                  href={linkTo(
                    lang,
                    `/routes/${stationSlug(station)}-to-${stationSlug(south)}/`,
                  )}
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <span>{station} → {south}</span>
                  <PillBadge
                    label={`$${fareBetween(zone, zoneOf(south)).toFixed(2)}`}
                    color="ontime"
                  />
                </a>
              </li>
            )}
          </ul>
        </CardContent>
      </SectionCard>

      {/* Ferry connection (Larkspur only) */}
      {isLarkspur ? (
        <SectionCard>
          <CardHeader>
            <CardTitle>{t("seo.station.ferryHeading")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              {t("seo.station.ferryBody")}{" "}
              <a
                href={linkTo(lang, "/ferry-connection/")}
                className="font-semibold hover:underline text-smart-train-green"
              >
                {t("seo.station.ferryLink")}
              </a>
            </p>
          </CardContent>
        </SectionCard>
      ) : null}

      {/* FAQ */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.station.faqHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {(["cost", "firstTrain", "parking"] as const).map((key) => (
              <div key={key}>
                <dt className="font-semibold">
                  {t(`seo.station.faq.${key}.q`, { station })}
                </dt>
                <dd className="text-muted-foreground mt-1">
                  {t(`seo.station.faq.${key}.a`, { station, zone })}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </SectionCard>

      {/* Cross-discovery: other stations */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.station.otherStationsHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            {north ? (
              <a
                href={linkTo(lang, `/stations/${stationSlug(north)}/`)}
                className="hover:underline text-smart-train-green"
              >
                ← {t("seo.station.prev", { station: north })}
              </a>
            ) : (
              <span />
            )}
            {south ? (
              <a
                href={linkTo(lang, `/stations/${stationSlug(south)}/`)}
                className="hover:underline text-smart-train-green"
              >
                {t("seo.station.next", { station: south })} →
              </a>
            ) : (
              <span />
            )}
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm list-none p-0">
            {STATION_ORDER.filter((s) => s !== station).map((s) => (
              <li key={s}>
                <a
                  href={linkTo(lang, `/stations/${stationSlug(s)}/`)}
                  className="hover:underline"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </SectionCard>

      {/* Secondary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "secondary",
            webappQuery: `from=${encodeURIComponent(station)}`,
          }),
        }}
      />
    </Layout>
  );
}
