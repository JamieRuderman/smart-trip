// Static landing page template for a single SMART station.
//
// Constraints — these are non-negotiable for the prerender pipeline:
//   - PURE component: no hooks, no Context, no React Router, no QueryClient
//   - All data is supplied as props by the prerender script
//   - Uses existing Tailwind classes so visual identity matches the SPA
//     without importing any SPA JS
//
// The component is rendered with renderToStaticMarkup; the resulting HTML
// is wrapped in src/seo/shell.ts to produce the final document.

import React, { type ReactNode } from "react";
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
import { stationSlug } from "../../scripts/seo/slugify";
import {
  SITE_NAME,
  DATA_ATTRIBUTION,
  SITE_DISCLAIMER,
  LANG_PATH_PREFIX,
  type Lang,
} from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";

export interface StationLandingPageProps {
  station: Station;
  lang: Lang;
  /** ISO timestamp string from schedules.json `generatedAt`. */
  scheduleGeneratedAt: string;
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

interface ScheduleTableProps {
  station: Station;
  type: ScheduleType;
  lang: Lang;
}

function ScheduleTable({ station, type, lang }: ScheduleTableProps): ReactNode {
  const t = translator(lang);
  const stationIndex = STATION_ORDER.indexOf(station);
  const trips = trainSchedules[type];
  const northbound = trips.northbound
    .map((trip) => ({ trip: trip.trip, time: trip.times[stationIndex] }))
    .filter((entry) => entry.time);
  const southbound = trips.southbound
    .map((trip) => ({ trip: trip.trip, time: trip.times[stationIndex] }))
    .filter((entry) => entry.time);

  return (
    <section className="my-8">
      <h2 className="text-2xl font-bold mb-4">
        {t(
          type === "weekday"
            ? "seo.station.weekdayHeading"
            : "seo.station.weekendHeading",
          { station },
        )}
      </h2>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold mb-2">
            {t("seo.station.northbound")}
          </h3>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-4">
                  {t("seo.station.tripColumn")}
                </th>
                <th className="text-left py-1">{t("seo.station.timeColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {northbound.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-1 text-muted-foreground">
                    {t("seo.station.noService")}
                  </td>
                </tr>
              ) : (
                northbound.map(({ trip, time }) => (
                  <tr key={`nb-${trip}`} className="border-b last:border-0">
                    <td className="py-1 pr-4">#{trip}</td>
                    <td className="py-1 font-mono">{time}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="font-semibold mb-2">
            {t("seo.station.southbound")}
          </h3>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-4">
                  {t("seo.station.tripColumn")}
                </th>
                <th className="text-left py-1">{t("seo.station.timeColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {southbound.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-1 text-muted-foreground">
                    {t("seo.station.noService")}
                  </td>
                </tr>
              ) : (
                southbound.map(({ trip, time }) => (
                  <tr key={`sb-${trip}`} className="border-b last:border-0">
                    <td className="py-1 pr-4">#{trip}</td>
                    <td className="py-1 font-mono">{time}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function StationLandingPage({
  station,
  lang,
  scheduleGeneratedAt,
}: StationLandingPageProps): ReactNode {
  const t = translator(lang);
  const slug = stationSlug(station);
  const { north, south } = neighbors(station);
  const zone = zoneOf(station);
  const pos = directionOf(station);
  const generatedDate = new Date(scheduleGeneratedAt).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  const isLarkspur = station === "Larkspur";

  return (
    <article className="container mx-auto px-4 py-8 max-w-4xl">
      <nav aria-label="Breadcrumb" className="text-sm mb-4">
        <ol className="flex gap-2 text-muted-foreground">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {SITE_NAME}
            </a>
            {" /"}
          </li>
          <li className="text-foreground" aria-current="page">
            {t("seo.station.breadcrumb", { station })}
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl md:text-4xl font-bold mb-4">
        {t("seo.station.h1", { station })}
      </h1>

      <p className="text-lg text-muted-foreground mb-6">
        {t(`seo.station.intro.${pos}`, { station, zone })}
      </p>

      {/* Primary CTA — high on the page so visitors funnel to the right app */}
      <div
        // dangerouslySetInnerHTML lets us drop in raw CTA markup (string from
        // src/seo/cta.ts) that includes the data-cta attribute pairing.
        // The CTA logic intentionally lives outside the React tree because
        // it needs to coordinate with an inline script.
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent(station)}`,
          }),
        }}
      />

      <ScheduleTable station={station} type="weekday" lang={lang} />
      <ScheduleTable station={station} type="weekend" lang={lang} />

      {/* Fare summary to adjacent stations */}
      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.station.fareHeading")}
        </h2>
        <p className="mb-3">
          {t("seo.station.fareZone", { station, zone })}
        </p>
        <ul className="space-y-1">
          {north && (
            <li>
              <a
                href={linkTo(lang, `/routes/${stationSlug(station)}-to-${stationSlug(north)}/`)}
                className="hover:underline"
              >
                {t("seo.station.fareRow", {
                  from: station,
                  to: north,
                  price: fareBetween(zone, zoneOf(north)).toFixed(2),
                })}
              </a>
            </li>
          )}
          {south && (
            <li>
              <a
                href={linkTo(lang, `/routes/${stationSlug(station)}-to-${stationSlug(south)}/`)}
                className="hover:underline"
              >
                {t("seo.station.fareRow", {
                  from: station,
                  to: south,
                  price: fareBetween(zone, zoneOf(south)).toFixed(2),
                })}
              </a>
            </li>
          )}
        </ul>
      </section>

      {/* Ferry connection mention for Larkspur, and for nearby stations as a link */}
      {isLarkspur ? (
        <section className="my-8">
          <h2 className="text-2xl font-bold mb-4">
            {t("seo.station.ferryHeading")}
          </h2>
          <p>
            {t("seo.station.ferryBody")}{" "}
            <a
              href={linkTo(lang, "/ferry-connection/")}
              className="font-semibold hover:underline"
            >
              {t("seo.station.ferryLink")}
            </a>
          </p>
        </section>
      ) : null}

      {/* FAQ — also emitted as JSON-LD FAQPage by the prerender shell */}
      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.station.faqHeading")}
        </h2>
        <dl className="space-y-4">
          {(["cost", "firstTrain", "parking"] as const).map((key) => (
            <div key={key}>
              <dt className="font-semibold">
                {t(`seo.station.faq.${key}.q`, { station })}
              </dt>
              <dd className="text-muted-foreground">
                {t(`seo.station.faq.${key}.a`, { station, zone })}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Cross-discovery link graph: prev/next + all stations */}
      <nav className="my-8" aria-label="Other stations">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.station.otherStationsHeading")}
        </h2>
        <div className="flex justify-between text-sm mb-4">
          {north ? (
            <a
              href={linkTo(lang, `/stations/${stationSlug(north)}/`)}
              className="hover:underline"
            >
              ← {t("seo.station.prev", { station: north })}
            </a>
          ) : (
            <span />
          )}
          {south ? (
            <a
              href={linkTo(lang, `/stations/${stationSlug(south)}/`)}
              className="hover:underline"
            >
              {t("seo.station.next", { station: south })} →
            </a>
          ) : (
            <span />
          )}
        </div>
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
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
      </nav>

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

      <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground">
        <p className="mb-2">
          {t("seo.station.lastUpdated", { date: generatedDate })}
        </p>
        <p className="mb-2">{DATA_ATTRIBUTION}</p>
        <p className="mb-4">{SITE_DISCLAIMER}</p>
        <p>
          <a
            href={linkTo(lang === "en" ? "es" : "en", `/stations/${slug}/`)}
            className="hover:underline"
            hrefLang={lang === "en" ? "es" : "en"}
          >
            {lang === "en" ? "Ver en español" : "View in English"}
          </a>
        </p>
      </footer>
    </article>
  );
}
