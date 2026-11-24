import { useState, useCallback } from "react";
import type { FareType } from "@/types/smartSchedule";
import { APP_CONSTANTS, FARE_TYPES } from "@/lib/fareConstants";
import { logger } from "@/lib/logger";

export interface UserPreferences {
  selectedFareType: FareType;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  selectedFareType: "adult",
};

const STORAGE_KEY = APP_CONSTANTS.PREFERENCES_STORAGE_KEY;

function loadPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { selectedFareType?: string };
      const fareType = parsed.selectedFareType;
      // "none" was stored by the old "Show all fares" button.
      if (fareType && Object.keys(FARE_TYPES).includes(fareType)) {
        return { selectedFareType: fareType as FareType };
      }
    }
  } catch (error) {
    logger.warn("Failed to load user preferences", error);
  }
  return DEFAULT_PREFERENCES;
}

/**
 * Custom hook for managing user preferences with localStorage persistence
 */
export function useUserPreferences() {
  const [preferences, setPreferences] =
    useState<UserPreferences>(loadPreferences);

  // Save preferences to localStorage whenever they change
  const savePreferences = useCallback(
    (newPreferences: Partial<UserPreferences>) => {
      try {
        const updated = { ...preferences, ...newPreferences };
        setPreferences(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        logger.warn("Failed to save user preferences", error);
      }
    },
    [preferences]
  );

  // Update selected fare type
  const updateSelectedFareType = useCallback(
    (fareType: FareType) => {
      savePreferences({
        selectedFareType: fareType,
      });
    },
    [savePreferences]
  );

  return {
    preferences,
    updateSelectedFareType,
  };
}
