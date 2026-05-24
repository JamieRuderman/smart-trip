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
  /** Vite-hashed path to the SMART agency logo (e.g. "/assets/smart-logo-DWriAflm.svg"). */
  smartLogoHref: string;
  children: ReactNode;
}

// HeartHandshake icon path data, mirrored from lucide-react v0.462. The
// SPA uses <HeartHandshake /> from lucide-react for the Community App
// badge; we inline the same paths to match without importing a React
// component through the prerender JSX-runtime boundary.
const HEART_HANDSHAKE_PATHS = [
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  "M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66",
  "m18 15-2-2",
  "m15 18-2-2",
];

function HeartHandshakeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["inline-block", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {HEART_HANDSHAKE_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function Layout({
  lang,
  alternateLangPath,
  scheduleGeneratedAt,
  smartLogoHref,
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
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-start sm:items-center justify-between gap-4 flex-wrap">
          <a
            href={`${LANG_PATH_PREFIX[lang]}/`}
            className="block hover:opacity-90"
            aria-label={SITE_NAME}
          >
            <img
              src={smartLogoHref}
              alt="Sonoma-Marin Area Rail Transit Logo"
              className="h-auto w-48 sm:w-64 max-w-full"
              width={384}
              height={130}
            />
          </a>
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-medium bg-white/15 border border-white/20 whitespace-nowrap">
            <HeartHandshakeIcon className="h-3.5 w-3.5" />
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
