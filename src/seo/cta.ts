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

// SMART train icon SVG, mirrored from src/components/icons/TripIcon.tsx.
// Inlined as a raw HTML string because the CTA is built as a template
// literal (not React), so we can't reuse the JSX TripRow/TripIcon helpers.
const TRAIN_ICON_SVG = `<svg viewBox="0 0 512 512" fill="none" stroke="currentColor" class="inline-block h-5 w-5" aria-hidden="true"><path d="M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308" stroke-width="42.67" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
  // Match the SectionCard radius so CTAs share the same rounded silhouette
  // as the other cards on the page.
  const blockClass =
    "my-8 p-6 rounded-[1.5rem] sm:rounded-[2rem] border bg-card text-card-foreground shadow-sm";
  const headingClass = "text-xl font-bold mb-2";
  const subtitleClass = "text-muted-foreground mb-4";
  const buttonClass =
    "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 transition no-underline";

  // iOS CTA uses Apple's official App Store badge image per their marketing
  // guidelines — no surrounding button background, no modifications to the
  // artwork. h-[44px] is just above Apple's 40px minimum. We use the English
  // badge in both languages because Apple distributes it that way and the
  // mark is globally recognized; only the heading/subtitle translate.
  const badgeLinkClass =
    "inline-block hover:opacity-90 transition no-underline";
  const badgeImgClass = "h-[44px] w-auto block";

  return `<aside class="${blockClass}" data-cta-position="${position}" aria-label="${escapeHtml(t("seo.cta.aria"))}">
  <div data-cta="ios" hidden>
    <h2 class="${headingClass}">${escapeHtml(t("seo.cta.ios.title"))}</h2>
    <p class="${subtitleClass}">${escapeHtml(t("seo.cta.ios.subtitle"))}</p>
    <a class="${badgeLinkClass}" href="${escapeHtml(APP_STORE_URL)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t("seo.cta.ios.appStore"))}">
      <img src="/badges/app-store-en.svg" alt="${escapeHtml(t("seo.cta.ios.appStore"))}" class="${badgeImgClass}" width="132" height="44" />
    </a>
  </div>
  <div data-cta="desktop">
    <h2 class="${headingClass}">${escapeHtml(t("seo.cta.desktop.title"))}</h2>
    <p class="${subtitleClass}">${escapeHtml(t("seo.cta.desktop.subtitle"))}</p>
    <a class="${buttonClass}" href="${escapeHtml(webappHref)}">
      ${TRAIN_ICON_SVG}
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
