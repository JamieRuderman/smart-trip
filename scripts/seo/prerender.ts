/*
 * SEO static page prerenderer.
 *
 * Runs after `vite build` (web mode only, never `--mode native`). Reads the
 * generated station/schedule/ferry data, renders each page template with
 * renderToStaticMarkup, wraps the result in the document shell, and writes
 * one HTML file per output path into dist/.
 *
 * Pages produced:
 *   /stations/<slug>/index.html        × 14 stations × 2 langs = 28
 *   /routes/<from>-to-<to>/index.html  × ~7 pairs × 2 langs    = ~14
 *   /ferry-connection/index.html       × 1 × 2 langs           = 2
 *   /sitemap.xml                       × 1
 *   /robots.txt                        rewritten with Sitemap line
 *
 * Run via:
 *   tsx scripts/seo/prerender.ts
 *   (chained automatically inside `npm run build`)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  STATION_ORDER,
  type Station,
} from "../../src/data/generated/stations.generated.ts";
import { StationLandingPage } from "../../src/seo/StationLandingPage.tsx";
import { RoutePairLandingPage } from "../../src/seo/RoutePairLandingPage.tsx";
import { FerryConnectionLandingPage } from "../../src/seo/FerryConnectionLandingPage.tsx";
import {
  renderShell,
  hreflangFor,
  STYLESHEET_HREF_PLACEHOLDER,
} from "../../src/seo/shell.ts";
import { buildSitemap, type SitemapEntry } from "../../src/seo/sitemap.ts";
import {
  breadcrumbList,
  trainStation,
  faqPage,
  websiteJsonLd,
  organizationJsonLd,
} from "../../src/seo/jsonld.ts";
import { translator } from "../../src/seo/i18n.ts";
import {
  LANGUAGES,
  LANG_PATH_PREFIX,
  SITE_URL,
  SITE_NAME,
  type Lang,
} from "../../src/seo/constants.ts";
import { stationSlug, routePairSlug } from "./slugify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const distDir = path.join(repoRoot, "dist");

// ---------------------------------------------------------------------------
// Top route pairs (per the approved plan).
// ---------------------------------------------------------------------------
const TOP_ROUTE_PAIRS: Array<readonly [Station, Station]> = [
  ["Larkspur", "Santa Rosa Downtown"],
  ["Santa Rosa Downtown", "Larkspur"],
  ["Larkspur", "Petaluma Downtown"],
  ["Petaluma Downtown", "Larkspur"],
  ["Larkspur", "San Rafael"],
  ["San Rafael", "Larkspur"],
  ["Larkspur", "Novato Downtown"],
  ["Novato Downtown", "Larkspur"],
  ["Larkspur", "Sonoma County Airport"],
  ["San Rafael", "Santa Rosa Downtown"],
];

// ---------------------------------------------------------------------------
// Locate hashed assets Vite produced for the main SPA entry.
//
// Vite names emitted assets after the source name: index.html → index-*.css;
// `import smartLogo from "@/assets/smart-logo.svg"` → smart-logo-*.svg.
// Matching the literal name prefix is deterministic and survives future
// lazy-route additions.
// ---------------------------------------------------------------------------
function findAssetByPrefix(prefix: string, extension: string): string {
  const assetsDir = path.join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) {
    throw new Error(
      `dist/assets not found at ${assetsDir}. Did vite build run before this script?`,
    );
  }
  const pattern = new RegExp(`^${prefix}-.*\\.${extension}$`);
  const match = fs.readdirSync(assetsDir).find((f) => pattern.test(f));
  if (!match) {
    throw new Error(
      `Could not find ${prefix}-*.${extension} in dist/assets — Vite asset naming may have changed.`,
    );
  }
  return `/assets/${match}`;
}

function findStylesheetHref(): string {
  return findAssetByPrefix("index", "css");
}

function findSmartLogoHref(): string {
  return findAssetByPrefix("smart-logo", "svg");
}

// ---------------------------------------------------------------------------
// Read schedules.json generatedAt for last-modified timestamps.
// ---------------------------------------------------------------------------
interface SchedulesPayload {
  generatedAt?: string;
}
function readScheduleGeneratedAt(): string {
  const schedulesPath = path.join(distDir, "data", "schedules.json");
  if (!fs.existsSync(schedulesPath)) {
    // Falls back to current time so we still emit a valid lastmod.
    return new Date().toISOString();
  }
  const raw = fs.readFileSync(schedulesPath, "utf8");
  const parsed = JSON.parse(raw) as SchedulesPayload;
  return parsed.generatedAt ?? new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Write a single page: render template → wrap in shell → write to disk.
// ---------------------------------------------------------------------------
function writePage(opts: {
  outputPath: string; // relative to dist/, e.g. "stations/larkspur/index.html"
  html: string;
}): void {
  const fullPath = path.join(distDir, opts.outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, opts.html, "utf8");
}

function substituteStylesheet(html: string, stylesheetHref: string): string {
  return html.replaceAll(STYLESHEET_HREF_PLACEHOLDER, stylesheetHref);
}

// ---------------------------------------------------------------------------
// Page builders.
// ---------------------------------------------------------------------------
function buildStationPage(
  station: Station,
  lang: Lang,
  scheduleGeneratedAt: string,
  stylesheetHref: string,
  smartLogoHref: string,
): string {
  const slug = stationSlug(station);
  const t = translator(lang);
  const body = renderToStaticMarkup(
    createElement(StationLandingPage, {
      station,
      lang,
      scheduleGeneratedAt,
      smartLogoHref,
    }),
  );

  const pathOnSite = `${LANG_PATH_PREFIX[lang]}/stations/${slug}/`;
  const title = t("seo.station.title", { station, site: SITE_NAME });
  const description = t("seo.station.description", { station });

  const jsonLd = [
    breadcrumbList([
      { name: SITE_NAME, path: `${LANG_PATH_PREFIX[lang]}/` },
      { name: station, path: pathOnSite },
    ]),
    trainStation(station, lang),
    faqPage([
      {
        question: t("seo.station.faq.cost.q", { station }),
        answer: t("seo.station.faq.cost.a", { station }),
      },
      {
        question: t("seo.station.faq.firstTrain.q", { station }),
        answer: t("seo.station.faq.firstTrain.a", { station }),
      },
      {
        question: t("seo.station.faq.parking.q", { station }),
        answer: t("seo.station.faq.parking.a", { station }),
      },
    ]),
  ];

  const html = renderShell({
    lang,
    title,
    description,
    canonicalPath: pathOnSite,
    hreflang: hreflangFor(`/stations/${slug}/`),
    jsonLd,
    bodyHtml: body,
  });

  return substituteStylesheet(html, stylesheetHref);
}

function buildRoutePairPage(
  from: Station,
  to: Station,
  lang: Lang,
  scheduleGeneratedAt: string,
  stylesheetHref: string,
  smartLogoHref: string,
): string {
  const slug = routePairSlug(from, to);
  const t = translator(lang);
  const body = renderToStaticMarkup(
    createElement(RoutePairLandingPage, {
      from,
      to,
      lang,
      scheduleGeneratedAt,
      smartLogoHref,
    }),
  );

  const pathOnSite = `${LANG_PATH_PREFIX[lang]}/routes/${slug}/`;
  const title = t("seo.route.title", { from, to, site: SITE_NAME });
  const description = t("seo.route.description", { from, to });

  const jsonLd = [
    breadcrumbList([
      { name: SITE_NAME, path: `${LANG_PATH_PREFIX[lang]}/` },
      { name: from, path: `${LANG_PATH_PREFIX[lang]}/stations/${stationSlug(from)}/` },
      { name: to, path: pathOnSite },
    ]),
  ];

  const html = renderShell({
    lang,
    title,
    description,
    canonicalPath: pathOnSite,
    hreflang: hreflangFor(`/routes/${slug}/`),
    jsonLd,
    bodyHtml: body,
  });

  return substituteStylesheet(html, stylesheetHref);
}

function buildFerryPage(
  lang: Lang,
  scheduleGeneratedAt: string,
  stylesheetHref: string,
  smartLogoHref: string,
): string {
  const t = translator(lang);
  const body = renderToStaticMarkup(
    createElement(FerryConnectionLandingPage, {
      lang,
      scheduleGeneratedAt,
      smartLogoHref,
    }),
  );

  const pathOnSite = `${LANG_PATH_PREFIX[lang]}/ferry-connection/`;
  const title = t("seo.ferry.title", { site: SITE_NAME });
  const description = t("seo.ferry.description");

  const jsonLd = [
    breadcrumbList([
      { name: SITE_NAME, path: `${LANG_PATH_PREFIX[lang]}/` },
      { name: t("seo.ferry.breadcrumb"), path: pathOnSite },
    ]),
  ];

  const html = renderShell({
    lang,
    title,
    description,
    canonicalPath: pathOnSite,
    hreflang: hreflangFor("/ferry-connection/"),
    jsonLd,
    bodyHtml: body,
  });

  return substituteStylesheet(html, stylesheetHref);
}

// ---------------------------------------------------------------------------
// Build a crawlable sitelinks footer for the SPA homepage.
//
// The homepage (dist/index.html) is a client-rendered SPA whose <body> is just
// `<div id="root">`, so it ships ZERO static <a href> links. That left every
// prerendered station/route/ferry page orphaned: Google could only reach them
// via the sitemap (no internal links from the one indexed, authoritative page),
// which is the classic cause of "Discovered – currently not indexed".
//
// This footer lives OUTSIDE #root, so React never overwrites it, and it is
// present in the raw HTML regardless of JS — giving Googlebot a crawl path from
// the homepage into the whole landing-page cluster. Generated from the same
// STATION_ORDER / TOP_ROUTE_PAIRS data as the pages + sitemap so it can't drift.
// ---------------------------------------------------------------------------
function buildSiteLinksFooter(): string {
  const stationLinks = STATION_ORDER.map(
    (station) =>
      `<a href="/stations/${stationSlug(station)}/">${station}</a>`,
  ).join('<span class="sep"> · </span>');

  const routeLinks = TOP_ROUTE_PAIRS.map(
    ([from, to]) =>
      `<a href="/routes/${routePairSlug(from, to)}/">${from} → ${to}</a>`,
  ).join('<span class="sep"> · </span>');

  // Self-contained styles (scoped by id) so the block doesn't depend on the
  // hashed app stylesheet's utility classes. Colors reference the app's global
  // CSS custom properties (src/index.css) so the footer matches the muted
  // "Help and legal" text in BottomInfoBar exactly and follows dark mode.
  return `
    <footer id="seo-sitelinks" aria-label="Browse SMART train stations and routes">
      <style>
        #seo-sitelinks{max-width:56rem;margin:0 auto;padding:1.5rem 1.25rem 2rem;font-size:.75rem;line-height:1.6;color:hsl(var(--muted-foreground));border-top:1px solid hsl(var(--border))}
        #seo-sitelinks p{margin:.35rem 0}
        #seo-sitelinks .label{color:hsl(var(--foreground));opacity:.7;font-weight:500}
        #seo-sitelinks .sep{opacity:.4}
        #seo-sitelinks a{color:inherit;text-decoration:none;text-underline-offset:2px}
        #seo-sitelinks a:hover{color:hsl(var(--foreground));text-decoration:underline}
      </style>
      <nav>
        <p><span class="label">Stations:</span> ${stationLinks}</p>
        <p><span class="label">Routes:</span> ${routeLinks}</p>
        <p><span class="label">Connections:</span> <a href="/ferry-connection/">Larkspur ferry connection</a></p>
      </nav>
    </footer>`;
}

// ---------------------------------------------------------------------------
// Inject site-wide JSON-LD + a crawlable sitelinks footer into the SPA's
// dist/index.html (Phase 1 hygiene).
// ---------------------------------------------------------------------------
function enhanceSpaIndexHtml(): void {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, "utf8");
  if (html.includes("seo-jsonld-website")) return; // idempotent

  const blocks: Array<{ id: string; payload: unknown }> = [
    { id: "seo-jsonld-website", payload: websiteJsonLd("en") },
    { id: "seo-jsonld-organization", payload: organizationJsonLd() },
  ];
  const injection = blocks
    .map(
      ({ id, payload }) =>
        `<script type="application/ld+json" id="${id}">${JSON.stringify(payload).replace(/<\//g, "<\\/")}</script>`,
    )
    .join("\n    ");

  // Only add a canonical if the source index.html didn't already include one.
  // (Source `index.html` may opt to set a canonical with a domain that the
  // operator wants to control directly — don't second-guess it.)
  const canonical = html.includes("rel=\"canonical\"")
    ? ""
    : `    <link rel="canonical" href="${SITE_URL}/" />\n`;

  html = html.replace(
    "</head>",
    `${canonical}    ${injection}\n  </head>`,
  );

  // Crawlable internal links into the landing-page cluster. Placed just before
  // </body>, after #root, so it survives React mounting.
  html = html.replace("</body>", `    ${buildSiteLinksFooter()}\n  </body>`);

  fs.writeFileSync(indexPath, html, "utf8");
}

// ---------------------------------------------------------------------------
// Rewrite robots.txt with Sitemap reference.
// ---------------------------------------------------------------------------
function writeRobotsTxt(): void {
  const robotsPath = path.join(distDir, "robots.txt");
  let existing = "";
  if (fs.existsSync(robotsPath)) existing = fs.readFileSync(robotsPath, "utf8");

  if (!existing.includes("Sitemap:")) {
    existing = `${existing.trimEnd()}\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
    fs.writeFileSync(robotsPath, existing, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir}. Run 'vite build' first.`);
  }

  const stylesheetHref = findStylesheetHref();
  const smartLogoHref = findSmartLogoHref();
  const scheduleGeneratedAt = readScheduleGeneratedAt();

  let pageCount = 0;
  const sitemapEntries: SitemapEntry[] = [
    { path: "/", hasLangVariants: false, priority: 1.0, changefreq: "daily" },
  ];

  // Station pages
  for (const station of STATION_ORDER) {
    for (const lang of LANGUAGES) {
      const slug = stationSlug(station);
      const html = buildStationPage(
        station,
        lang,
        scheduleGeneratedAt,
        stylesheetHref,
        smartLogoHref,
      );
      writePage({
        outputPath: path.join(
          LANG_PATH_PREFIX[lang].replace(/^\//, ""),
          "stations",
          slug,
          "index.html",
        ),
        html,
      });
      pageCount++;
    }
    sitemapEntries.push({
      path: `/stations/${stationSlug(station)}/`,
      priority: 0.8,
      changefreq: "weekly",
    });
  }

  // Route-pair pages
  for (const [from, to] of TOP_ROUTE_PAIRS) {
    for (const lang of LANGUAGES) {
      const slug = routePairSlug(from, to);
      const html = buildRoutePairPage(
        from,
        to,
        lang,
        scheduleGeneratedAt,
        stylesheetHref,
        smartLogoHref,
      );
      writePage({
        outputPath: path.join(
          LANG_PATH_PREFIX[lang].replace(/^\//, ""),
          "routes",
          slug,
          "index.html",
        ),
        html,
      });
      pageCount++;
    }
    sitemapEntries.push({
      path: `/routes/${routePairSlug(from, to)}/`,
      priority: 0.6,
      changefreq: "weekly",
    });
  }

  // Ferry page
  for (const lang of LANGUAGES) {
    const html = buildFerryPage(
      lang,
      scheduleGeneratedAt,
      stylesheetHref,
      smartLogoHref,
    );
    writePage({
      outputPath: path.join(
        LANG_PATH_PREFIX[lang].replace(/^\//, ""),
        "ferry-connection",
        "index.html",
      ),
      html,
    });
    pageCount++;
  }
  sitemapEntries.push({
    path: "/ferry-connection/",
    priority: 0.7,
    changefreq: "weekly",
  });

  // Sitemap + robots
  const sitemap = buildSitemap({
    entries: sitemapEntries,
    lastmod: scheduleGeneratedAt,
  });
  fs.writeFileSync(path.join(distDir, "sitemap.xml"), sitemap, "utf8");
  writeRobotsTxt();

  // SPA homepage hygiene
  enhanceSpaIndexHtml();

  console.log(
    `[seo/prerender] Wrote ${pageCount} static pages + sitemap.xml. Stylesheet: ${stylesheetHref}`,
  );
}

main();
