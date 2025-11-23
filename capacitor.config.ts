import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "smart.trains.schedule",
  appName: "SMART Train Schedule",
  webDir: "dist",
  plugins: {
    Keyboard: {
      resize: "body",
      style: "dark",
    },
    SplashScreen: {
      launchAutoHide: true,
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
