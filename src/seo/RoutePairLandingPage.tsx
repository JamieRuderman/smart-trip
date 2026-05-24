// Static landing page for a from→to journey on the SMART train. Pure component;
// uses src/seo/ui.tsx mirrors of the SPA's Card / SectionCard / PillBadge.

import React from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.
import type { Station } from "@/data/generated/stations.generated";
import { STATION_ORDER, STATION_ZONES } from "@/data/generated/stations.generated";
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
import { stationSlug, routePairSlug } from "../../scripts/seo/slugify";
import { LANG_PATH_PREFIX, type Lang } from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";
import { Layout } from "./Layout";
import { TripRow } from "./TripRow";

export interface RoutePairLandingPageProps {
  from: Station;
  to: Station;
  lang: Lang;
  scheduleGeneratedAt: string;
  smartLogoHref: string;
}

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

const zoneOf = (station: Station): number =>
  STATION_ZONES.find((z) => z.station === station)?.zone ?? 0;

// Minutes between two HH:MM strings. SMART doesn't run overnight today, but
// using `(arrive - depart + 1440) % 1440` instead of Math.abs keeps us
// correct if service ever crosses midnight.
function durationMinutes(depart: string, arrive: string): number {
  const [dh, dm] = depart.split(":").map(Number);
  const [ah, am] = arrive.split(":").map(Number);
  const departTotal = dh * 60 + dm;
  const arriveTotal = ah * 60 + am;
  return (arriveTotal - departTotal + 1440) % 1440;
}

function formatDuration(mins: number, lang: Lang): string {
  const t = translator(lang);
  if (mins < 60) return t("seo.route.minutes", { mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0
    ? t("seo.route.hours", { hours: h })
    : t("seo.route.hoursMinutes", { hours: h, mins: m });
}

interface RouteScheduleCardProps {
  fromIndex: number;
  toIndex: number;
  direction: "northbound" | "southbound";
  type: ScheduleType;
  lang: Lang;
}

function RouteScheduleCard({
  fromIndex,
  toIndex,
  direction,
  type,
  lang,
}: RouteScheduleCardProps) {
  const t = translator(lang);
  const trips = trainSchedules[type][direction]
    .map((trip) => {
      const depart = trip.times[fromIndex];
      const arrive = trip.times[toIndex];
      if (!depart || !arrive) return null;
      return {
        trip: trip.trip,
        depart,
        arrive,
        duration: durationMinutes(depart, arrive),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <SectionCard>
      <CardHeader>
        <CardTitle>
          {t(
            type === "weekday"
              ? "seo.route.weekdayHeading"
              : "seo.route.weekendHeading",
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("seo.route.noService")}
          </p>
        ) : (
          <ul className="space-y-2 list-none p-0">
            {trips.map(({ trip, depart, arrive, duration }) => (
              <li key={trip}>
                <TripRow
                  tripNumber={trip}
                  time={depart}
                  arriveTime={arrive}
                  trailing={formatDuration(duration, lang)}
                  direction={direction === "northbound" ? "north" : "south"}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </SectionCard>
  );
}

export function RoutePairLandingPage({
  from,
  to,
  lang,
  scheduleGeneratedAt,
  smartLogoHref,
}: RoutePairLandingPageProps) {
  const t = translator(lang);
  const fromIndex = STATION_ORDER.indexOf(from);
  const toIndex = STATION_ORDER.indexOf(to);
  // STATION_ORDER goes north → south, so a higher index is further south.
  // Travelling from south (higher index) to north (lower index) = northbound.
  const direction: "northbound" | "southbound" =
    fromIndex > toIndex ? "northbound" : "southbound";
  const zones = Math.abs(zoneOf(from) - zoneOf(to)) + 1;
  const fare = zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE;

  return (
    <Layout
      lang={lang}
      alternateLangPath={`/routes/${routePairSlug(from, to)}/`}
      scheduleGeneratedAt={scheduleGeneratedAt}
      smartLogoHref={smartLogoHref}
    >
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex gap-2 text-muted-foreground flex-wrap">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {t("seo.layout.home")}
            </a>
            <span aria-hidden="true"> /</span>
          </li>
          <li>
            <a
              href={linkTo(lang, `/stations/${stationSlug(from)}/`)}
              className="hover:underline"
            >
              {from}
            </a>
            <span aria-hidden="true"> /</span>
          </li>
          <li className="text-foreground" aria-current="page">
            {t("seo.route.breadcrumb", { to })}
          </li>
        </ol>
      </nav>

      {/* Title + summary */}
      <section className="space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t("seo.route.h1", { from, to })}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <PillBadge label={t(`seo.route.dir.${direction}`)} color="ontime" />
          <PillBadge
            label={t("seo.route.zonesPill", { zones })}
            color="neutral"
          />
          <PillBadge label={`$${fare.toFixed(2)}`} color="neutral" />
        </div>
        <p className="text-lg text-muted-foreground">
          {t("seo.route.intro", {
            from,
            to,
            direction: t(`seo.route.dir.${direction}`),
          })}
        </p>
      </section>

      {/* Primary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          }),
        }}
      />

      {/* Schedules */}
      <RouteScheduleCard
        fromIndex={fromIndex}
        toIndex={toIndex}
        direction={direction}
        type="weekday"
        lang={lang}
      />
      <RouteScheduleCard
        fromIndex={fromIndex}
        toIndex={toIndex}
        direction={direction}
        type="weekend"
        lang={lang}
      />

      {/* Related */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.route.relatedHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm list-none p-0">
            <li>
              <a
                href={linkTo(lang, `/stations/${stationSlug(from)}/`)}
                className="hover:underline"
              >
                {t("seo.route.viewStation", { station: from })}
              </a>
            </li>
            <li>
              <a
                href={linkTo(lang, `/stations/${stationSlug(to)}/`)}
                className="hover:underline"
              >
                {t("seo.route.viewStation", { station: to })}
              </a>
            </li>
            <li>
              <a
                href={linkTo(lang, `/routes/${routePairSlug(to, from)}/`)}
                className="hover:underline"
              >
                {t("seo.route.viewReverse", { from: to, to: from })}
              </a>
            </li>
          </ul>
        </CardContent>
      </SectionCard>

      {/* Secondary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "secondary",
            webappQuery: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          }),
        }}
      />
    </Layout>
  );
}
