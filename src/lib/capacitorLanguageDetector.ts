import { Device } from "@capacitor/device";
import { Capacitor } from "@capacitor/core";

// Cache device language to avoid async issues during i18next initialization
// Export for use in i18n.ts
export let cachedDeviceLanguage: string | undefined;

/**
 * Initialize device language detection (call this before i18next.init)
 * This pre-fetches the device language so the detector can return it synchronously
 */
export const initDeviceLanguage = async (): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Device.getLanguageCode();
      if (result?.value) {
        // Normalize to base language code (e.g., "es-MX" -> "es")
        const baseLang = result.value.toLowerCase().split("-")[0];
        cachedDeviceLanguage = ["en", "es"].includes(baseLang) ? baseLang : undefined;
      }
    } catch (error) {
      // If Device API fails, cache will remain undefined
      console.warn("Failed to get device language code:", error);
    }
  }
};

/**
 * Get current system language (device language on native, navigator on web)
 * This is used to determine if a user's selection matches the system
 */
export const getSystemLanguage = async (): Promise<string> => {
  // On native platforms, use Capacitor Device API
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Device.getLanguageCode();
      if (result?.value) {
        const baseLang = result.value.toLowerCase().split("-")[0];
        if (["en", "es"].includes(baseLang)) {
          return baseLang;
        }
      }
    } catch (error) {
      console.warn("Failed to get device language code:", error);
    }
  }
  
  // Fall back to navigator for web or if Device API fails
  if (typeof navigator !== "undefined") {
    // Check navigator.languages array (preferred languages) first
    if (navigator.languages && navigator.languages.length > 0) {
      for (const lang of navigator.languages) {
        const baseLang = lang.toLowerCase().split("-")[0];
        if (["en", "es"].includes(baseLang)) {
          return baseLang;
        }
      }
    }
    // Fall back to navigator.language (primary language)
    if (navigator.language) {
      const systemLang = navigator.language.toLowerCase().split("-")[0];
      if (["en", "es"].includes(systemLang)) {
        return systemLang;
      }
    }
  }
  
  return "en"; // Default fallback
};

/**
 * Custom language detector that uses Capacitor Device API for native apps
 * and falls back to browser detection for web
 */
const capacitorLanguageDetector = {
  name: "capacitorDevice" as const,
  lookup: (): string | undefined => {
    // Return cached device language (set by initDeviceLanguage)
    // If not on native platform or not cached, return undefined to fall back to next detector
    return cachedDeviceLanguage;
  },
  cacheUserLanguage: () => {
    // We manage localStorage manually, so don't cache here
  },
};

export default capacitorLanguageDetector;
