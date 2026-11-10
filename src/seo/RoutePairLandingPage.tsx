// Static landing page for a from→to journey on the SMART train, or by train
// and the Larkspur ferry when one end is San Francisco. Pure component; uses
// src/seo/ui.tsx mirrors of the SPA's Card / SectionCard / PillBadge.

import React from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.
import { STATION_ORDER } from "@/data/generated/stations.generated";
import type { ScheduleType } from "@/data/generated/trainSchedules.generated";
import { FERRY_CONSTANTS, FERRY_FARES } from "@/lib/fareConstants";
import { SAN_FRANCISCO, isFerryLeg, placeStation, type Place } from "@/lib/places";
import { calculateFare, getFilteredTrips, tripEnds } from "@/lib/scheduleUtils";
import {
  CardContent,
  CardHeader,
  CardTitle,
  SectionCard,
  PillBadge,
} from "./ui";
import { routePairSlug } from "../../scripts/seo/slugify";
import { placePath } from "./routes";
import { LANG_PATH_PREFIX, type Lang } from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";
import { Layout } from "./Layout";
import { TripRow } from "./TripRow";

export interface RoutePairLandingPageProps {
  from: Place;
  to: Place;
  lang: Lang;
  scheduleGeneratedAt: string;
  smartLogoHref: string;
}

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

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
  from: Place;
  to: Place;
  direction: "northbound" | "southbound";
  type: ScheduleType;
  lang: Lang;
}

function RouteScheduleCard({
  from,
  to,
  direction,
  type,
  lang,
}: RouteScheduleCardProps) {
  const t = translator(lang);
  const trips = getFilteredTrips(
    placeStation(from),
    placeStation(to),
    type,
    isFerryLeg(from, to),
  ).map((trip) => {
    const { start, end } = tripEnds(trip);
    const ferry = trip.inboundFerry ?? trip.outboundFerry;
    return {
      trip: trip.trip,
      start,
      end,
      duration: durationMinutes(start, end),
      ferryLeg: ferry
        ? t("seo.route.ferryLeg", { depart: ferry.depart, arrive: ferry.arrive })
        : undefined,
    };
  });

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
            {trips.map(({ trip, start, end, duration, ferryLeg }) => (
              <li key={trip}>
                <TripRow
                  tripNumber={trip}
                  time={start}
                  arriveTime={end}
                  trailing={formatDuration(duration, lang)}
                  direction={direction === "northbound" ? "north" : "south"}
                  detail={ferryLeg}
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
  const fromStation = placeStation(from);
  const toStation = placeStation(to);
  const viaFerry = isFerryLeg(from, to);
  // STATION_ORDER goes north → south, so a higher index is further south.
  // Travelling from south (higher index) to north (lower index) = northbound.
  const direction: "northbound" | "southbound" =
    STATION_ORDER.indexOf(fromStation) > STATION_ORDER.indexOf(toStation)
      ? "northbound"
      : "southbound";
  const fare = calculateFare(fromStation, toStation, "adult", viaFerry);
  const webappQuery = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const touchesLarkspur =
    viaFerry ||
    fromStation === FERRY_CONSTANTS.FERRY_STATION ||
    toStation === FERRY_CONSTANTS.FERRY_STATION;

  return (
    <Layout
      lang={lang}
      alternateLangPath={`/routes/${routePairSlug(from, to)}/`}
      scheduleGeneratedAt={scheduleGeneratedAt}
      smartLogoHref={smartLogoHref}
    >
      {/* Breadcrumb — px-6 matches the horizontal padding inside SectionCards. */}
      <nav aria-label="Breadcrumb" className="text-sm px-6">
        <ol className="flex gap-2 text-muted-foreground flex-wrap">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {t("seo.layout.home")}
            </a>
            <span aria-hidden="true"> /</span>
          </li>
          <li>
            <a href={linkTo(lang, placePath(from))} className="hover:underline">
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
      <section className="space-y-3 px-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t(viaFerry ? "seo.route.ferryH1" : "seo.route.h1", { from, to })}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <PillBadge label={t(`seo.route.dir.${direction}`)} color="ontime" />
          {viaFerry && (
            <PillBadge label={t("seo.route.ferryPill")} color="neutral" />
          )}
          <PillBadge
            label={t("seo.route.zonesPill", { zones: fare.zones })}
            color="neutral"
          />
          <PillBadge label={`$${fare.price.toFixed(2)}`} color="neutral" />
        </div>
        <p className="text-lg text-muted-foreground">
          {viaFerry
            ? t(
                from === SAN_FRANCISCO
                  ? "seo.route.ferryIntro.fromSf"
                  : "seo.route.ferryIntro.toSf",
                { from, to },
              )
            : t("seo.route.intro", {
                from,
                to,
                direction: t(`seo.route.dir.${direction}`),
              })}
        </p>
        {fare.ferryPrice != null && (
          <p className="text-muted-foreground">
            {t("seo.route.ferryFare", {
              total: fare.price.toFixed(2),
              train: (fare.price - fare.ferryPrice).toFixed(2),
              ferry: fare.ferryPrice.toFixed(2),
              reduced: FERRY_FARES.youth.toFixed(2),
            })}
          </p>
        )}
      </section>

      {/* Primary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({ lang, position: "primary", webappQuery }),
        }}
      />

      {/* Schedules */}
      <RouteScheduleCard
        from={from}
        to={to}
        direction={direction}
        type="weekday"
        lang={lang}
      />
      <RouteScheduleCard
        from={from}
        to={to}
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
            {[from, to]
              .filter((place) => place !== SAN_FRANCISCO)
              .map((station) => (
                <li key={station}>
                  <a
                    href={linkTo(lang, placePath(station))}
                    className="hover:underline"
                  >
                    {t("seo.route.viewStation", { station })}
                  </a>
                </li>
              ))}
            {touchesLarkspur && (
              <li>
                <a
                  href={linkTo(lang, placePath(SAN_FRANCISCO))}
                  className="hover:underline"
                >
                  {t("seo.route.ferryLink")}
                </a>
              </li>
            )}
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
          __html: renderCta({ lang, position: "secondary", webappQuery }),
        }}
      />
    </Layout>
  );
}
