// Static landing page for the Larkspur ↔ SF ferry connection.
// Pure component; ferry schedules pulled at build time from generated data.

import React from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.
import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/generated/ferrySchedule.generated";
import type { FerryConnection } from "@/types/smartSchedule";
import {
  CardContent,
  CardHeader,
  CardTitle,
  SectionCard,
} from "./ui";
import { stationSlug } from "../../scripts/seo/slugify";
import { LANG_PATH_PREFIX, type Lang } from "./constants";
import { translator } from "./i18n";
import { renderCta } from "./cta";
import { Layout } from "./Layout";

export interface FerryConnectionLandingPageProps {
  lang: Lang;
  scheduleGeneratedAt: string;
}

const linkTo = (lang: Lang, path: string): string =>
  `${LANG_PATH_PREFIX[lang]}${path}`;

function FerryList({
  trips,
  heading,
  lang,
}: {
  trips: FerryConnection[];
  heading: string;
  lang: Lang;
}) {
  const t = translator(lang);
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
        {heading}
      </h3>
      {trips.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {t("seo.ferry.noService")}
        </p>
      ) : (
        <ul className="space-y-1.5 list-none p-0">
          {trips.map(({ depart, arrive }, i) => (
            <li
              key={`${depart}-${i}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-card"
            >
              <span className="font-mono text-sm">{depart}</span>
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
              <span className="font-mono text-sm">{arrive}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FerryConnectionLandingPage({
  lang,
  scheduleGeneratedAt,
}: FerryConnectionLandingPageProps) {
  const t = translator(lang);

  return (
    <Layout
      lang={lang}
      alternateLangPath="/ferry-connection/"
      scheduleGeneratedAt={scheduleGeneratedAt}
    >
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex gap-2 text-muted-foreground">
          <li>
            <a href={linkTo(lang, "/")} className="hover:underline">
              {t("seo.layout.home")}
            </a>
            <span aria-hidden="true"> /</span>
          </li>
          <li className="text-foreground" aria-current="page">
            {t("seo.ferry.breadcrumb")}
          </li>
        </ol>
      </nav>

      {/* Title + intro */}
      <section className="space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t("seo.ferry.h1")}
        </h1>
        <p className="text-lg text-muted-foreground">{t("seo.ferry.intro")}</p>
      </section>

      {/* Primary CTA */}
      <div
        dangerouslySetInnerHTML={{
          __html: renderCta({
            lang,
            position: "primary",
            webappQuery: `from=${encodeURIComponent("Larkspur")}`,
          }),
        }}
      />

      {/* Weekday */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.ferry.weekdayHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <FerryList
              trips={weekdayFerries}
              heading={t("seo.ferry.outboundHeading")}
              lang={lang}
            />
            <FerryList
              trips={weekdayInboundFerries}
              heading={t("seo.ferry.inboundHeading")}
              lang={lang}
            />
          </div>
        </CardContent>
      </SectionCard>

      {/* Weekend */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.ferry.weekendHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <FerryList
              trips={weekendFerries}
              heading={t("seo.ferry.outboundHeading")}
              lang={lang}
            />
            <FerryList
              trips={weekendInboundFerries}
              heading={t("seo.ferry.inboundHeading")}
              lang={lang}
            />
          </div>
        </CardContent>
      </SectionCard>

      {/* Related */}
      <SectionCard>
        <CardHeader>
          <CardTitle>{t("seo.ferry.relatedHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm list-none p-0">
            <li>
              <a
                href={linkTo(lang, `/stations/${stationSlug("Larkspur")}/`)}
                className="hover:underline"
              >
                {t("seo.ferry.larkspurLink")}
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
            webappQuery: `from=${encodeURIComponent("Larkspur")}`,
          }),
        }}
      />
    </Layout>
  );
}
