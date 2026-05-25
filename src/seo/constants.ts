// Brand strings, URLs, and other constants shared by the static SEO library.
// These are imported by both the prerender script (scripts/seo/prerender.ts)
// and the SEO page templates (src/seo/*LandingPage.tsx).
//
// Anything that depends on the production domain lives here so it's a single
// place to update once smarttraintrip.com is registered and pointed at Vercel.

// Production site URL. Configured in Vercel with apex + www and a 308
// redirect from smart-trip-community.vercel.app to preserve crawl equity.
export const SITE_URL = "https://smarttraintrip.com" as const;

export const SITE_NAME = "SMART trip" as const;
export const SITE_TAGLINE =
  "Community-built SMART train schedules for Sonoma-Marin Area Rail Transit" as const;
export const SITE_DISCLAIMER =
  "Not affiliated with Sonoma-Marin Area Rail Transit (SMART) | this is an open-source community project." as const;

export const AUTHOR_NAME = "Jamie Ruderman" as const;

export const DATA_ATTRIBUTION = "Schedule data from 511.org and SMART" as const;

// Supported languages for the static SEO library. Each prerendered page is
// emitted once per language; English lives at the path root and Spanish under
// /es/.
export const LANGUAGES = ["en", "es"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANG_PATH_PREFIX: Record<Lang, string> = {
  en: "",
  es: "/es",
};

// iOS App Store listing. Android isn't released yet — Android visitors fall
// through to the desktop/webapp CTA instead of seeing a broken Play Store
// link.
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/smart-trip-community-app/id6758808442" as const;

// GitHub repo — linked from the "Community App" pill in the hero so users
// can verify the open-source claim. Matches src/components/StickyHeader.tsx.
export const COMMUNITY_REPO_URL =
  "https://github.com/JamieRuderman/smart-train-schedule" as const;

// Brand colors (kept in sync with tailwind config + index.html theme-color).
export const BRAND_PRIMARY = "#11ab75" as const;
