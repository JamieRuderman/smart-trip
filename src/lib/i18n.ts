import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import enTranslations from "./translations/en.json";
import esTranslations from "./translations/es.json";

i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: {
    en: {
      translation: enTranslations,
    },
    es: {
      translation: esTranslations,
    },
  },
  fallbackLng: "en",
  supportedLngs: ["en", "es"],
  // Force language to be one of our supported base languages
  load: "languageOnly", // Only load "es" not "es-MX"
  detection: {
    // Order of detection methods
    // localStorage first (user preference), then navigator (device/browser language)
    order: ["localStorage", "navigator", "htmlTag"],
    // Keys to lookup language from
    lookupLocalStorage: "smart-train-language",
    // Cache user language
    caches: ["localStorage"],
    // Convert detected language codes to our supported languages
    convertDetectedLanguage: (lng: string) => {
      // Extract base language code (e.g., "es" from "es-MX", "en" from "en-US")
      const baseLang = lng.toLowerCase().split("-")[0];
      // Return if supported, otherwise return undefined to use fallback
      return ["en", "es"].includes(baseLang) ? baseLang : undefined;
    },
  },
  interpolation: {
    escapeValue: false, // React already escapes
  },
  react: {
    useSuspense: false, // Disable suspense for better compatibility
  },
});

// Update document language attribute when language changes
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    // Normalize to base language code for HTML lang attribute
    const normalizedLang = lng.split("-")[0];
    document.documentElement.lang = normalizedLang;
    // Keep translate="no" to prevent browser auto-translation
    document.documentElement.setAttribute("translate", "no");
  }
});

// Set initial document language (normalized)
if (typeof document !== "undefined") {
  const normalizedLang = i18n.language?.split("-")[0] || "en";
  document.documentElement.lang = normalizedLang;
  document.documentElement.setAttribute("translate", "no");
}

export default i18n;
