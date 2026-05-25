import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "smart.trip",
  appName: "SMART trip",
  webDir: "dist",
  plugins: {
    Keyboard: {
      resize: "body",
      style: "dark",
    },
    SplashScreen: {
      launchShowDuration: 1000,
      launchAutoHide: true,
      backgroundColor: "#11ab75",
      showSpinner: false,
    },
    LocalNotifications: {
      // iOS automatically uses the app's launcher icon for local
      // notifications — no config needed there.
      //
      // Android requires a separate monochrome notification icon in
      // res/drawable-* (the launcher icon would render as a white square
      // because Android tints notification icons since API 21). Until a
      // proper ic_stat_smart_trip drawable is generated (e.g. via
      // Android Studio's Image Asset Studio from resources/icon.png),
      // the default debug icon is used. iconColor tints whatever icon
      // is in place to the brand green so the silhouette reads right.
      iconColor: "#11ab75",
    },
  },
};

if (process.env.CAPACITOR_LIVE_RELOAD_URL) {
  config.server = {
    url: process.env.CAPACITOR_LIVE_RELOAD_URL,
    cleartext: true,
  };
}

export default config;
