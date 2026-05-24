// Shared page chrome for SEO templates: green hero header + main content
// wrapper + footer. Centralised so all three landing-page types (station,
// route, ferry) have a single source of truth for top-level layout.
//
// Pure component — no hooks, no Router, no Context. Renders identically
// regardless of language; copy comes from translation props.

import React, { type ReactNode } from "react";
void React; // tsx (classic JSX) needs React in scope; tsc would flag unused.
import {
  SITE_NAME,
  DATA_ATTRIBUTION,
  SITE_DISCLAIMER,
  LANG_PATH_PREFIX,
  type Lang,
} from "./constants";
import { translator } from "./i18n";

interface LayoutProps {
  lang: Lang;
  /** Path to the alternate-language version of this same page (e.g. "/stations/larkspur/"). */
  alternateLangPath: string;
  /** ISO timestamp string from schedules.json `generatedAt`. */
  scheduleGeneratedAt: string;
  children: ReactNode;
}

export function Layout({
  lang,
  alternateLangPath,
  scheduleGeneratedAt,
  children,
}: LayoutProps) {
  const t = translator(lang);
  const generatedDate = new Date(scheduleGeneratedAt).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );
  const altLangCode = lang === "en" ? "es" : "en";
  const altLangLabel = lang === "en" ? "Ver en español" : "View in English";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Green hero — matches the SPA's bg-smart-train-green header band */}
      <header className="bg-smart-train-green text-white">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between gap-4">
          <a
            href={`${LANG_PATH_PREFIX[lang]}/`}
            className="text-2xl font-bold tracking-tight hover:opacity-90 no-underline text-white"
          >
            {SITE_NAME}
          </a>
          <span className="text-xs px-2.5 py-1 rounded-md font-medium bg-white/15 border border-white/20 whitespace-nowrap">
            {t("seo.layout.communityPill")}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">{children}</main>

      <footer className="max-w-4xl mx-auto px-4 py-8 mt-8 border-t text-sm text-muted-foreground space-y-2">
        <p>{t("seo.layout.lastUpdated", { date: generatedDate })}</p>
        <p>{DATA_ATTRIBUTION}</p>
        <p>{SITE_DISCLAIMER}</p>
        <p>
          <a
            href={`${LANG_PATH_PREFIX[altLangCode]}${alternateLangPath}`}
            hrefLang={altLangCode}
            className="hover:underline"
          >
            {altLangLabel}
          </a>
        </p>
      </footer>
    </div>
  );
}
