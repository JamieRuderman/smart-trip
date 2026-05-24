// CTA block for prerendered static SEO pages.
//
// Each page renders BOTH the mobile and desktop CTAs in the HTML so search
// engines see both messages, then a tiny inline script unhides the one that
// matches the visitor's user-agent. CSS fallback (with no JS) shows the
// desktop CTA — same as what most search-engine crawlers will see anyway.

import { APP_STORE_URL, PLAY_STORE_URL } from "./constants";
import { translator, type Lang } from "./i18n";

interface CtaProps {
  lang: Lang;
  /** Optional deep-link query for the desktop CTA, e.g. "from=Larkspur". */
  webappQuery?: string;
  /** Position label so primary/secondary CTAs get unique IDs for analytics. */
  position: "primary" | "secondary";
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Render the CTA block HTML. Returns a raw HTML string (the prerender script
 * concatenates this into the body alongside renderToStaticMarkup output for
 * the page-specific content).
 *
 * Why a string instead of a React component: keeping the inline script and
 * the data-cta attribute pairing in one place makes the swap logic easier to
 * audit, and avoids React serialising the `hidden` attribute in ways that
 * would race the script.
 */
export function renderCta({ lang, webappQuery, position }: CtaProps): string {
  const t = translator(lang);
  const webappHref = webappQuery ? `/?${webappQuery}` : "/";

  return `<aside class="cta-block" data-cta-position="${position}" aria-label="${escapeHtml(t("seo.cta.aria"))}">
  <div data-cta="mobile" hidden>
    <h2>${escapeHtml(t("seo.cta.mobile.title"))}</h2>
    <p>${escapeHtml(t("seo.cta.mobile.subtitle"))}</p>
    <div class="cta-links">
      <a class="cta-link cta-link-appstore" href="${escapeHtml(APP_STORE_URL)}" rel="noopener">
        ${escapeHtml(t("seo.cta.mobile.appStore"))}
      </a>
      <a class="cta-link cta-link-playstore" href="${escapeHtml(PLAY_STORE_URL)}" rel="noopener">
        ${escapeHtml(t("seo.cta.mobile.playStore"))}
      </a>
    </div>
  </div>
  <div data-cta="desktop">
    <h2>${escapeHtml(t("seo.cta.desktop.title"))}</h2>
    <p>${escapeHtml(t("seo.cta.desktop.subtitle"))}</p>
    <a class="cta-link cta-link-primary" href="${escapeHtml(webappHref)}">
      ${escapeHtml(t("seo.cta.desktop.button"))}
    </a>
  </div>
</aside>`;
}

/**
 * Inline script body (minus the <script> wrapper) that swaps CTA visibility
 * based on user-agent. Kept tiny — under 300 bytes — so it doesn't move
 * Lighthouse Performance off 100. Runs synchronously in <body> after the CTA
 * markup, so it can't FOUC.
 *
 * Conservative regex: matches the platforms we want to send to the app stores
 * (mobile phones + iPad). iPad-as-desktop (iPadOS 13+) deliberately gets the
 * desktop CTA because the user has explicitly opted out of mobile sites.
 */
export function ctaScript(): string {
  return `(function(){var m=/Android|iPhone|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);document.querySelectorAll('[data-cta]').forEach(function(el){el.hidden=el.getAttribute('data-cta')!==(m?'mobile':'desktop');});})();`;
}
