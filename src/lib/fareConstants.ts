/**
 * Fare calculation constants
 * These represent the current SMART train fare structure
 */

export const FARE_CONSTANTS = {
  // Base fare per zone for adults
  ADULT_FARE_PER_ZONE: 1.5,

  // Discount multipliers
  DISABLED_DISCOUNT: 0.5, // 50% off (multiply by 0.5, not 0.75)
  CLIPPER_START_DISCOUNT: 0.5, // 50% off (multiply by 0.5, not 0.75)

  // Quick connection threshold in minutes
  QUICK_CONNECTION_THRESHOLD: 10,

  // Time intervals
  MINUTE_UPDATE_INTERVAL: 60000, // 1 minute in milliseconds
} as const;

/**
 * Fare type configurations with descriptions
 */
export const FARE_TYPES = {
  adult: {
    multiplier: 1,
    description: "Adult (19-64)",
    isFree: false,
  },
  youth: {
    multiplier: 0,
    description: "Youth (0-18) - Free",
    isFree: true,
  },
  senior: {
    multiplier: 0,
    description: "Senior (65+) - Free",
    isFree: true,
  },
  disabled: {
    multiplier: FARE_CONSTANTS.DISABLED_DISCOUNT,
    description: "Disabled/Medicare - 50% off",
    isFree: false,
  },
  "clipper-start": {
    multiplier: FARE_CONSTANTS.CLIPPER_START_DISCOUNT,
    description: "Clipper START - 50% off",
    isFree: false,
  },
} as const;

/**
 * Ferry-specific constants
 */
export const FERRY_CONSTANTS = {
  // Station that has ferry connections
  FERRY_STATION: "Larkspur",
} as const;

/**
 * App configuration constants
 */
export const APP_CONSTANTS = {
  // Default time format
  DEFAULT_TIME_FORMAT: "12h" as const,

  // LocalStorage keys
  PREFERENCES_STORAGE_KEY: "smart-train-preferences",
  THEME_STORAGE_KEY: "vite-ui-theme",
  LANGUAGE_STORAGE_KEY: "smart-train-language",
} as const;
