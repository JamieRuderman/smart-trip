// Brand strings, URLs, and other constants shared by the static SEO library.
// These are imported by both the prerender script (scripts/seo/prerender.ts)
// and the SEO page templates (src/seo/*LandingPage.tsx).
//
// Anything that depends on the production domain lives here so it's a single
// place to update once smarttraintrip.com is registered and pointed at Vercel.

// ---------------------------------------------------------------------------
// Production site URL.
//
// TODO: swap to https://smarttraintrip.com once the domain is registered and
// pointed at Vercel (apex + www). Until then the prerendered <link rel="canonical">
// and sitemap entries will reference the .vercel.app URL — Google handles this
// fine, and we’ll do a single search-and-replace deploy when the domain flips.
// ---------------------------------------------------------------------------
export const SITE_URL = "https://smart-trip-community.vercel.app" as const;

export const SITE_NAME = "SMART trip" as const;
export const SITE_TAGLINE =
  "Community-built SMART train schedules for Sonoma-Marin Area Rail Transit" as const;
export const SITE_DISCLAIMER =
  "Not affiliated with Sonoma-Marin Area Rail Transit (SMART) — this is an open-source community project." as const;

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

// ---------------------------------------------------------------------------
// App Store / Play Store URLs for the mobile CTA.
//
// TODO: replace placeholders with real listing URLs once the apps are
// published. Leaving "#" hrefs makes the CTA visually present (and crawlable)
// without sending users to a broken destination.
// ---------------------------------------------------------------------------
export const APP_STORE_URL = "#" as const; // TODO: https://apps.apple.com/...
export const PLAY_STORE_URL = "#" as const; // TODO: https://play.google.com/store/apps/details?id=...

// Brand colors (kept in sync with tailwind config + index.html theme-color).
export const BRAND_PRIMARY = "#11ab75" as const;
