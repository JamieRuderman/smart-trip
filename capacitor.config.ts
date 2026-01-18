import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "smart.trains.schedule",
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
  },
};

if (process.env.CAPACITOR_LIVE_RELOAD_URL) {
  config.server = {
    url: process.env.CAPACITOR_LIVE_RELOAD_URL,
    cleartext: true,
  };
}

export default config;
