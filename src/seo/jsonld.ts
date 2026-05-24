// JSON-LD builders for the static SEO library.
//
// We only emit types Google actually surfaces (Search Central documentation,
// as of 2026-05):
//   - BreadcrumbList:    yes, renders breadcrumb rich result
//   - FAQPage:           yes, renders FAQ rich result for non-commercial sites
//   - TrainStation:      yes, used for entity recognition / Knowledge Graph
//                        (no rich card, but helps Google understand the page)
//   - WebSite + Organization: yes, used for sitelinks search box + entity
//
// We deliberately DO NOT emit:
//   - Schedule:         not used by Google for transit
//   - TouristAttraction:misleading, would mark stations as attractions
//
// Each builder returns a plain JS object. The shell stringifies and wraps
// each one in its own <script type="application/ld+json"> tag.

import type { Station } from "@/data/generated/stations.generated";
import { STATION_COORDINATES } from "@/data/generated/stationCoordinates.generated";
import { stationSlug } from "../../scripts/seo/slugify";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  AUTHOR_NAME,
  type Lang,
  LANG_PATH_PREFIX,
} from "./constants";
import { translator } from "./i18n";

interface BreadcrumbItem {
  name: string;
  path: string; // path without domain, with leading slash
}

export function breadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function trainStation(station: Station, lang: Lang) {
  const coords = STATION_COORDINATES[station];
  const t = translator(lang);
  return {
    "@context": "https://schema.org",
    "@type": "TrainStation",
    name: t("seo.station.schemaName", { station }),
    description: t("seo.station.schemaDescription", { station }),
    url: `${SITE_URL}${LANG_PATH_PREFIX[lang]}/stations/${stationSlug(station)}/`,
    geo: {
      "@type": "GeoCoordinates",
      latitude: coords.lat,
      longitude: coords.lng,
    },
    containedInPlace: {
      "@type": "AdministrativeArea",
      name: "Sonoma-Marin, California",
    },
    publicAccess: true,
  };
}

interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPage(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  };
}

export function websiteJsonLd(lang: Lang) {
  const t = translator(lang);
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: t("seo.site.alternateName"),
    url: SITE_URL,
    description: SITE_TAGLINE,
    inLanguage: lang === "es" ? "es" : "en",
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    founder: {
      "@type": "Person",
      name: AUTHOR_NAME,
    },
  };
}

