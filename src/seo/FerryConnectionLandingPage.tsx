// Static landing page for the Larkspur ↔ SF ferry connection.
// Pure component; ferry schedules pulled at build time from generated data.

import React, { type ReactNode } from "react";
import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/generated/ferrySchedule.generated";
import type { FerryConnection } from "@/types/smartSchedule";
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

export interface FerryConnectionLandingPageProps {
  lang: Lang;
  scheduleGeneratedAt: string;
}

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

interface FerryTableProps {
  trips: FerryConnection[];
  heading: string;
  lang: Lang;
}

function FerryTable({ trips, heading, lang }: FerryTableProps): ReactNode {
  const t = translator(lang);
  return (
    <div>
      <h3 className="font-semibold mb-2">{heading}</h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1 pr-4">{t("seo.ferry.departColumn")}</th>
            <th className="text-left py-1">{t("seo.ferry.arriveColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {trips.map(({ depart, arrive }, i) => (
            <tr key={`${depart}-${i}`} className="border-b last:border-0">
              <td className="py-1 pr-4 font-mono">{depart}</td>
              <td className="py-1 font-mono">{arrive}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FerryConnectionLandingPage({
  lang,
  scheduleGeneratedAt,
}: FerryConnectionLandingPageProps): ReactNode {
  const t = translator(lang);
  const generatedDate = new Date(scheduleGeneratedAt).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

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
            {t("seo.ferry.breadcrumb")}
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl md:text-4xl font-bold mb-4">
        {t("seo.ferry.h1")}
      </h1>
      <p className="text-lg text-muted-foreground mb-6">{t("seo.ferry.intro")}</p>

      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent("Larkspur")}`,
          }),
        }}
      />

      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.ferry.weekdayHeading")}
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <FerryTable
            trips={weekdayFerries}
            heading={t("seo.ferry.outboundHeading")}
            lang={lang}
          />
          <FerryTable
            trips={weekdayInboundFerries}
            heading={t("seo.ferry.inboundHeading")}
            lang={lang}
          />
        </div>
      </section>

      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.ferry.weekendHeading")}
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <FerryTable
            trips={weekendFerries}
            heading={t("seo.ferry.outboundHeading")}
            lang={lang}
          />
          <FerryTable
            trips={weekendInboundFerries}
            heading={t("seo.ferry.inboundHeading")}
            lang={lang}
          />
        </div>
      </section>

      <section className="my-8">
        <h2 className="text-2xl font-bold mb-4">
          {t("seo.ferry.relatedHeading")}
        </h2>
        <ul className="space-y-1 text-sm">
          <li>
            <a
              href={linkTo(lang, `/stations/${stationSlug("Larkspur")}/`)}
              className="hover:underline"
            >
              {t("seo.ferry.larkspurLink")}
            </a>
          </li>
        </ul>
      </section>

      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "secondary",
            webappQuery: `from=${encodeURIComponent("Larkspur")}`,
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
            href={linkTo(lang === "en" ? "es" : "en", "/ferry-connection/")}
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
