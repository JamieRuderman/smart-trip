// CTA block for prerendered static SEO pages.
//
// Each page renders BOTH the iOS-app and webapp CTAs in the HTML so search
// engines see both messages, then a tiny inline script unhides the one that
// matches the visitor's user-agent.
//
// Detection rule: only iOS (iPhone / iPod / iPad pre-iPadOS-13) sees the
// App Store CTA. Everyone else — Android phones, Android tablets, desktop
// browsers, and iPadOS desktop-mode — gets the "Open SMART trip" webapp CTA
// because (a) there's no Android app yet, and (b) the webapp is the better
// experience for Android until that ships. With no JS, the desktop CTA is
// the default, which is also what crawlers will see.

import { APP_STORE_URL } from "./constants";
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

  // All styling via Tailwind utilities so the static pages match the SPA's
  // design system without needing a separate stylesheet. Tailwind picks these
  // classes up via its content scan of src/**/*.ts.
  const blockClass =
    "my-8 p-6 rounded-xl border bg-card text-card-foreground shadow-sm";
  const headingClass = "text-xl font-bold mb-2";
  const subtitleClass = "text-muted-foreground mb-4";
  const buttonClass =
    "inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 transition no-underline";

  return `<aside class="${blockClass}" data-cta-position="${position}" aria-label="${escapeHtml(t("seo.cta.aria"))}">
  <div data-cta="ios" hidden>
    <h2 class="${headingClass}">${escapeHtml(t("seo.cta.ios.title"))}</h2>
    <p class="${subtitleClass}">${escapeHtml(t("seo.cta.ios.subtitle"))}</p>
    <a class="${buttonClass}" href="${escapeHtml(APP_STORE_URL)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(t("seo.cta.ios.appStore"))}
    </a>
  </div>
  <div data-cta="desktop">
    <h2 class="${headingClass}">${escapeHtml(t("seo.cta.desktop.title"))}</h2>
    <p class="${subtitleClass}">${escapeHtml(t("seo.cta.desktop.subtitle"))}</p>
    <a class="${buttonClass}" href="${escapeHtml(webappHref)}">
      ${escapeHtml(t("seo.cta.desktop.button"))}
    </a>
  </div>
</aside>`;
}

/**
 * Inline script body (minus the <script> wrapper) that swaps CTA visibility
 * based on user-agent. Kept tiny — under 200 bytes — so it doesn't move
 * Lighthouse Performance off 100. Runs synchronously in <body> after the CTA
 * markup, so it can't FOUC.
 *
 * Only matches iOS devices (iPhone / iPod / pre-iPadOS-13 iPad). Android and
 * everything else falls through to the desktop/webapp CTA — because there's
 * no Android app yet and the webapp is the better Android experience.
 * iPadOS 13+ in desktop mode (no "iPad" in UA) also gets the desktop CTA,
 * which is fine: those users explicitly opted out of mobile sites.
 */
export function ctaScript(): string {
  return `(function(){var i=/iPhone|iPod|iPad/i.test(navigator.userAgent);document.querySelectorAll('[data-cta]').forEach(function(el){el.hidden=el.getAttribute('data-cta')!==(i?'ios':'desktop');});})();`;
}
