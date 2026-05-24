/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Static landing page for a from→to journey on the SMART train.
// Pure component, same constraints as StationLandingPage. The JSX pragmas
// above force tsx + esbuild to use the automatic JSX runtime so no
// `import React` is needed at runtime.

import type { ReactNode } from "react";
import type { Station } from "@/data/generated/stations.generated";
import { STATION_ORDER } from "@/data/generated/stations.generated";
import {
  trainSchedules,
  type ScheduleType,
} from "@/data/generated/trainSchedules.generated";
import { FARE_CONSTANTS } from "@/lib/fareConstants";
import { stationSlug, routePairSlug } from "../../scripts/seo/slugify";
import {
  STATION_ZONES,
} from "@/data/generated/stations.generated";
import {
  SITE_NAME,
  DATA_ATTRIBUTION,
  SITE_DISCLAIMER,
  LANG_PATH_PREFIX,
  type Lang,
} from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";

export interface RoutePairLandingPageProps {
  from: Station;
  to: Station;
  lang: Lang;
  scheduleGeneratedAt: string;
}

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

const zoneOf = (station: Station): number =>
  STATION_ZONES.find((z) => z.station === station)?.zone ?? 0;

// Minutes between two HH:MM strings. SMART doesn't run overnight today, but
// using `(arrive - depart + 1440) % 1440` instead of `Math.abs(...)` keeps
// us correct if service ever crosses midnight — and matches the
// stationIndex→stationIndex order the caller passes (always forward in
// travel direction), so the result is always positive without abs().
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

interface RouteScheduleTableProps {
  fromIndex: number;
  toIndex: number;
  direction: "northbound" | "southbound";
  type: ScheduleType;
  lang: Lang;
}

function RouteScheduleTable({
  fromIndex,
  toIndex,
  direction,
  type,
  lang,
}: RouteScheduleTableProps): ReactNode {
  const t = translator(lang);
  const trips = trainSchedules[type][direction];
  const rows = trips
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
    <section className="my-8">
      <h2 className="text-2xl font-bold mb-4">
        {t(
          type === "weekday"
            ? "seo.route.weekdayHeading"
            : "seo.route.weekendHeading",
        )}
      </h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4">{t("seo.route.tripColumn")}</th>
            <th className="text-left py-2 pr-4">
              {t("seo.route.departColumn")}
            </th>
            <th className="text-left py-2 pr-4">
              {t("seo.route.arriveColumn")}
            </th>
            <th className="text-left py-2">{t("seo.route.durationColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-2 text-muted-foreground">
                {t("seo.route.noService")}
              </td>
            </tr>
          ) : (
            rows.map(({ trip, depart, arrive, duration }) => (
              <tr key={trip} className="border-b last:border-0">
                <td className="py-1 pr-4">#{trip}</td>
                <td className="py-1 pr-4 font-mono">{depart}</td>
                <td className="py-1 pr-4 font-mono">{arrive}</td>
                <td className="py-1">{formatDuration(duration, lang)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

export function RoutePairLandingPage({
  from,
  to,
  lang,
  scheduleGeneratedAt,
}: RoutePairLandingPageProps): ReactNode {
  const t = translator(lang);
  const fromIndex = STATION_ORDER.indexOf(from);
  const toIndex = STATION_ORDER.indexOf(to);
  // STATION_ORDER goes north → south, so a higher index is further south.
  // Travelling from south (higher index) to north (lower index) = northbound.
  const direction: "northbound" | "southbound" =
    fromIndex > toIndex ? "northbound" : "southbound";
  const zones = Math.abs(zoneOf(from) - zoneOf(to)) + 1;
  const fare = zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE;
  const generatedDate = new Date(scheduleGeneratedAt).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <article className="container mx-auto px-4 py-8 max-w-4xl">
      <nav aria-label="Breadcrumb" className="text-sm mb-4">
        <ol className="flex gap-2 text-muted-foreground flex-wrap">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {SITE_NAME}
            </a>
            {" /"}
          </li>
          <li>
            <a
              href={linkTo(lang, `/stations/${stationSlug(from)}/`)}
              className="hover:underline"
            >
              {from}
            </a>
            {" /"}
          </li>
          <li className="text-foreground" aria-current="page">
            {t("seo.route.breadcrumb", { to })}
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl md:text-4xl font-bold mb-4">
        {t("seo.route.h1", { from, to })}
      </h1>
      <p className="text-lg text-muted-foreground mb-6">
        {t("seo.route.intro", { from, to, direction: t(`seo.route.dir.${direction}`) })}
      </p>

      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          }),
        }}
      />

      <section className="my-8 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="font-semibold">{t("seo.route.fareLabel")}</dt>
          <dd>${fare.toFixed(2)} ({zones} {t(zones === 1 ? "common.zone" : "common.zones")})</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("seo.route.directionLabel")}</dt>
          <dd>{t(`seo.route.dir.${direction}`)}</dd>
        </div>
      </section>

      <RouteScheduleTable
        fromIndex={fromIndex}
        toIndex={toIndex}
        direction={direction}
        type="weekday"
        lang={lang}
      />
      <RouteScheduleTable
        fromIndex={fromIndex}
        toIndex={toIndex}
        direction={direction}
        type="weekend"
        lang={lang}
      />

      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.route.relatedHeading")}
        </h2>
        <ul className="space-y-1 text-sm">
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
      </section>

      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "secondary",
            webappQuery: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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
            href={linkTo(
              lang === "en" ? "es" : "en",
              `/routes/${routePairSlug(from, to)}/`,
            )}
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
