// HTML document shell for prerendered static SEO pages.
//
// The shell is intentionally lightweight: it loads the same compiled
// Tailwind/`index.css` stylesheet the SPA produces so visuals match, but it
// does NOT include the SPA's <script src="/assets/index-*.js"> bundle.
// These pages are pure HTML doorways into the app — no hydration, no React
// runtime on the page after first paint.

import {
  SITE_URL,
  SITE_NAME,
  BRAND_PRIMARY,
  type Lang,
  LANG_PATH_PREFIX,
} from "./constants";
import { ctaScript } from "./cta";

interface HreflangAlternate {
  lang: Lang | "x-default";
  href: string;
}

interface ShellOptions {
  lang: Lang;
  /** Full title including site name. Used verbatim in <title>. */
  title: string;
  /** ~140-160 char meta description. */
  description: string;
  /** Path on this site, with leading slash, no domain (e.g. "/stations/larkspur/"). */
  canonicalPath: string;
  /** hreflang alternates including x-default; emitted in <head>. */
  hreflang: HreflangAlternate[];
  /** Optional path to a per-page OG image; falls back to /og/default.png. */
  ogImagePath?: string;
  /**
   * JSON-LD blocks. Each entry is the JS object that will be stringified into
   * its own <script type="application/ld+json"> tag.
   */
  jsonLd: unknown[];
  /** Pre-rendered HTML for the page body (output of renderToStaticMarkup). */
  bodyHtml: string;
}

/** Path to the compiled CSS bundle Vite emits. Stable across builds because
 *  we strip the content hash when reading it from the manifest. */
export const STYLESHEET_HREF_PLACEHOLDER = "__SEO_STYLESHEET_HREF__";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeJsonLd = (s: string): string =>
  // Per Google’s JSON-LD guidance, only </ needs escaping to prevent the
  // parser ending the script early.
  s.replace(/<\//g, "<\\/");

function jsonLdScript(payload: unknown): string {
  const body = escapeJsonLd(JSON.stringify(payload));
  return `<script type="application/ld+json">${body}</script>`;
}

export function renderShell(opts: ShellOptions): string {
  const canonical = `${SITE_URL}${opts.canonicalPath}`;
  const ogImage = `${SITE_URL}${opts.ogImagePath ?? "/og/default.png"}`;

  const hreflangTags = opts.hreflang
    .map(
      ({ lang, href }) =>
        `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(href)}" />`,
    )
    .join("\n    ");

  const jsonLdBlocks = opts.jsonLd.map(jsonLdScript).join("\n    ");

  // The CSS link uses a build-time placeholder that prerender.ts substitutes
  // with the real hashed filename from the Vite manifest. We avoid hard-coding
  // a path because Vite mangles asset names for cache busting.
  return `<!DOCTYPE html>
<html lang="${opts.lang}" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${escapeHtml(opts.title)}</title>
    <meta name="description" content="${escapeHtml(opts.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    ${hreflangTags}
    <meta name="theme-color" content="${BRAND_PRIMARY}" />
    <meta name="author" content="${escapeHtml(SITE_NAME)}" />

    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(opts.title)}" />
    <meta property="og:description" content="${escapeHtml(opts.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:locale" content="${opts.lang === "es" ? "es_US" : "en_US"}" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(opts.title)}" />
    <meta name="twitter:description" content="${escapeHtml(opts.description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

    <!-- Favicon -->
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

    <!-- Fonts (match SPA so visual identity carries over) -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet" />

    <!-- Compiled Tailwind / app styles (path injected at prerender time) -->
    <link rel="stylesheet" href="${STYLESHEET_HREF_PLACEHOLDER}" />

    <!-- Structured data -->
    ${jsonLdBlocks}
  </head>
  <body class="bg-background text-foreground">
    ${opts.bodyHtml}
    <script>${ctaScript()}</script>
  </body>
</html>
`;
}

/**
 * Build the list of hreflang alternates for a page that exists in both
 * English and Spanish. The English variant is used as x-default per Google’s
 * recommendation for transit/local pages where English is the broader fallback.
 */
export function hreflangFor(pathWithoutLangPrefix: string): HreflangAlternate[] {
  return [
    {
      lang: "en",
      href: `${SITE_URL}${LANG_PATH_PREFIX.en}${pathWithoutLangPrefix}`,
    },
    {
      lang: "es",
      href: `${SITE_URL}${LANG_PATH_PREFIX.es}${pathWithoutLangPrefix}`,
    },
    {
      lang: "x-default",
      href: `${SITE_URL}${LANG_PATH_PREFIX.en}${pathWithoutLangPrefix}`,
    },
  ];
}
