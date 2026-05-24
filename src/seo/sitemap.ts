// sitemap.xml builder for the static SEO library.
//
// Each entry includes <xhtml:link rel="alternate" hreflang="..."> for the
// English / Spanish counterpart and an `x-default` pointing at English —
// matches the in-page hreflang tags emitted by src/seo/shell.ts so search
// engines see one consistent signal.
//
// Returns the complete XML document as a string. The prerender script writes
// it to dist/sitemap.xml.

import { SITE_URL, LANG_PATH_PREFIX, LANGUAGES, type Lang } from "./constants";

export interface SitemapEntry {
  /** Path without language prefix, with leading and trailing slash. */
  path: string;
  /** Set false for the homepage, which is the SPA, not a prerendered page. */
  hasLangVariants?: boolean;
  /** Crawl priority hint (0.0–1.0). */
  priority?: number;
  /** changefreq hint. */
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
}

interface BuildSitemapOptions {
  entries: SitemapEntry[];
  /** Last-modified date for all entries (typically schedules.json generatedAt). */
  lastmod: string;
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function urlEntry(
  loc: string,
  lastmod: string,
  alternates: { lang: Lang | "x-default"; href: string }[],
  priority: number | undefined,
  changefreq: SitemapEntry["changefreq"],
): string {
  const altTags = alternates
    .map(
      (alt) =>
        `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${xmlEscape(alt.href)}" />`,
    )
    .join("\n");
  const priorityTag =
    priority !== undefined ? `    <priority>${priority.toFixed(1)}</priority>\n` : "";
  const changefreqTag = changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : "";

  return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${xmlEscape(lastmod)}</lastmod>
${changefreqTag}${priorityTag}${altTags}
  </url>`;
}

export function buildSitemap({ entries, lastmod }: BuildSitemapOptions): string {
  const lastmodDate = lastmod.split("T")[0]; // YYYY-MM-DD for sitemap simplicity

  const urls = entries.flatMap((entry) => {
    if (entry.hasLangVariants === false) {
      return [
        urlEntry(
          `${SITE_URL}${entry.path}`,
          lastmodDate,
          [],
          entry.priority,
          entry.changefreq,
        ),
      ];
    }
    return LANGUAGES.map((lang) => {
      const loc = `${SITE_URL}${LANG_PATH_PREFIX[lang]}${entry.path}`;
      const alternates: { lang: Lang | "x-default"; href: string }[] = [
        ...LANGUAGES.map((l) => ({
          lang: l,
          href: `${SITE_URL}${LANG_PATH_PREFIX[l]}${entry.path}`,
        })),
        {
          lang: "x-default" as const,
          href: `${SITE_URL}${LANG_PATH_PREFIX.en}${entry.path}`,
        },
      ];
      return urlEntry(loc, lastmodDate, alternates, entry.priority, entry.changefreq);
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}
