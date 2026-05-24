import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import capacitorLanguageDetector, { initDeviceLanguage } from "./capacitorLanguageDetector";
import enTranslations from "./translations/en.json";
import esTranslations from "./translations/es.json";

// Detection order:
// 1. localStorage (user preference) takes precedence
// 2. capacitorDevice (native device language on Android/iOS)
// 3. navigator (browser language for web)
// 4. htmlTag (fallback)
const detectionOrder = ["localStorage", "capacitorDevice", "navigator", "htmlTag"];

// Create LanguageDetector instance and add custom Capacitor detector
const languageDetector = new LanguageDetector();
languageDetector.addDetector(capacitorLanguageDetector);

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
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
      order: detectionOrder,
      // Keys to lookup language from
      lookupLocalStorage: "smart-train-language",
      // Disable automatic caching - we manually manage localStorage
      // This allows system language changes to be detected when no manual selection exists
      caches: [],
      // Convert detected language codes to our supported languages
      convertDetectedLanguage: (lng: string) => {
        // Extract base language code (e.g., "es" from "es-MX", "en" from "en-US")
        const baseLang = lng.toLowerCase().split("-")[0] ?? lng;
        // Return supported base lang; unsupported codes pass through and
        // i18next falls back via `fallbackLng` + `supportedLngs`.
        return ["en", "es"].includes(baseLang) ? baseLang : lng;
      },
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false, // Disable suspense for better compatibility
    },
  });

// Initialize device language detection after i18next init
// This pre-fetches the device language for the detector to use
initDeviceLanguage();

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
