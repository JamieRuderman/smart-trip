// Minimal translation helper for prerender-time use.
//
// We deliberately don’t use the runtime `i18next` setup at src/lib/i18n.ts —
// that one is tied to React context and a browser-only language detector, and
// can’t be initialised cleanly inside a Node build script. The static SEO
// pages need a synchronous, dependency-free `t()` that works on the same
// translation JSON the app already maintains.
//
// Translation keys consumed by the SEO pages live under the top-level "seo"
// namespace in en.json / es.json. If a key is missing in a non-English
// translation we fall back to English so the page still renders.

import en from "@/lib/translations/en.json" with { type: "json" };
import es from "@/lib/translations/es.json" with { type: "json" };
import { LANGUAGES, type Lang } from "./constants";

type TranslationMap = Record<string, unknown>;

const dictionaries: Record<Lang, TranslationMap> = {
  en: en as TranslationMap,
  es: es as TranslationMap,
};

function lookup(dict: TranslationMap, key: string): string | undefined {
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Look up a translation key for the given language. Falls back to English if
 * the key is missing in the target dictionary. If the key is missing in both,
 * returns the key itself so the gap is visible in the rendered HTML.
 */
export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const primary = lookup(dictionaries[lang], key);
  if (primary !== undefined) return interpolate(primary, vars);
  if (lang !== "en") {
    const fallback = lookup(dictionaries.en, key);
    if (fallback !== undefined) return interpolate(fallback, vars);
  }
  return key;
}

/** Convenience: build a `t()` curried to one language for cleaner templates. */
export function translator(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>): string =>
    t(key, lang, vars);
}

export { LANGUAGES };
export type { Lang };
