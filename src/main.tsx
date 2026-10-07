import { Capacitor } from '@capacitor/core'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { openTripViewOnLaunch } from './lib/tripView'
import './index.css'

// The SEO sitelinks footer is injected into index.html by the web-only
// prerender step (scripts/seo/prerender.ts). `build-native` skips prerender so
// it normally never ships in the apps, but web + native share dist/, so strip
// it defensively when running on iOS/Android — it's meaningless there.
if (Capacitor.isNativePlatform()) {
  document.getElementById("seo-sitelinks")?.remove();
}

// A launch with a trip running today opens straight into the My Trip view.
// Must run before the router mounts and reads the URL.
openTripViewOnLaunch();

createRoot(document.getElementById("root")!).render(<App />);
