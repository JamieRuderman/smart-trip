# SMART Train Schedule

A modern, responsive web application for viewing Sonoma-Marin Area Rail Transit (SMART) train schedules and ferry connections.
This is an open-source community project and is not an official SMART app.

## 🚆 Features

- **Schedule Display**: View current and upcoming train departures
- **Real-Time Updates**: Live delay, cancellation, and skipped-stop indicators on each trip card, sourced from SMART's GTFS-RT feed
- **In-App Service Alerts**: Live service alerts from SMART with an unread badge and slide-in notification panel
- **Interactive Route Planning**: Select departure and arrival stations with easy station swapping
- **Ferry Integration**: See connecting ferry schedules to San Francisco
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Accessibility**: Built with screen readers and keyboard navigation in mind
- **Weekend/Weekday Schedules**: Toggle between different schedule types
- **Next Train Highlighting**: Easily identify the next available train
- **Dark Mode Support**: Automatic theme switching based on system preference with manual override
- **Bilingual**: Full English and Spanish support

## 🛠️ Technology Stack

- **Frontend**: React 18 with TypeScript
- **Styling**: Tailwind CSS with custom SMART branding
- **UI Components**: Radix UI primitives with shadcn/ui
- **Build Tool**: Vite for fast development and building
- **Mobile**: Capacitor for native iOS and Android apps
- **Data Fetching**: TanStack React Query for polling and caching
- **Real-Time Data**: GTFS-RT 2.0 via Vercel serverless API routes (proxy to 511.org)
- **Routing**: React Router DOM
- **State Management**: React hooks with optimized performance
- **i18n**: react-i18next (English + Spanish)
- **Code Quality**: ESLint, TypeScript strict mode

## 🚀 Quick Start

### Prerequisites

- Node.js (version 18 or higher)
- npm or yarn package manager
- Vercel CLI for local real-time API development (`npm i -g vercel` or use via `npx`)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd smart-train-schedule
```

2. Install dependencies:
```bash
npm install
```

1. Copy `.env.example` to `.env` and add your 511.org API key:

   ```bash
   TRANSIT_511_API_KEY=your_key_here
   ```

1. Start the development server alongside the Vercel API routes:

   ```bash
   npm run dev:vercel
   ```

   Or, for static-only development without real-time data:

   ```bash
   npm run dev
   ```

1. Open your browser and navigate to `http://localhost:3210` (or the port Vercel dev assigns)

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## 📱 Usage

1. **Select Your Route**: Choose your departure and arrival stations from the dropdown menus
2. **Choose Schedule Type**: Toggle between weekday and weekend schedules
3. **View Results**: See all available trains with departure and arrival times; live delay or cancellation badges appear automatically
4. **Ferry Connections**: When traveling to Larkspur, ferry connection information is automatically displayed
5. **Service Alerts**: Tap the bell icon at the bottom to open the notification panel with live SMART service alerts
6. **Theme Toggle**: Switch between light, dark, and system themes using the theme toggle at the bottom of the page

## 🎨 Design System

The application uses SMART's official brand colors:
- **SMART Green**: `#114533` - Primary brand color
- **SMART Gold**: `#E48E25` - Secondary accent color

The application supports both light and dark themes:
- **Light Theme**: Clean, bright interface optimized for daytime use
- **Dark Theme**: Easy on the eyes for nighttime viewing
- **System Theme**: Automatically matches your device's theme preference

The design follows modern web standards with:
- Consistent spacing and typography
- Accessible color contrast ratios
- Responsive breakpoints for all device sizes
- Smooth animations and transitions

## 📊 Data Structure

Train schedule data is organized by:
- **Stations**: 14 stations from Windsor to Larkspur
- **Directions**: Northbound and Southbound
- **Schedule Types**: Weekday and Weekend/Holiday
- **Ferry Connections**: Integrated Larkspur-San Francisco ferry schedules

Real-time data is sourced from SMART's GTFS-RT 2.0 feed via 511.org and flows through Vercel serverless functions:

```
511.org GTFS-RT (protobuf)
    ↓ (Vercel serverless — keeps API key server-side, solves CORS)
/api/gtfsrt/alerts       →  useServiceAlerts  →  NotificationPanel + bell badge
/api/gtfsrt/tripupdates  →  useTripUpdates    →  TripCard delay/cancel badges
```

Trip updates are matched to static schedule entries by scheduled departure time at the origin station (since SMART generates new `trip_id` values per service date).

## ⏱️ Timetable Updates

- Set the `TRANSIT_511_API_KEY` environment variable with your 511.org developer token (the updater automatically reads it from `.env`, `.env.local`, or your shell environment).
- Run `npm run update-transit` to download the latest SMART (`operator_id=SA`) and Golden Gate Ferry (`operator_id=GF`) GTFS feeds and rewrite the generated data under `src/data/generated/`.
- `npm run build` is sufficient for Vercel deploys. It always emits `public/data/schedules.json` from the generated source data during `prebuild`.
- Use `npm run update-build` only when you intentionally want to refresh from 511.org and then build.
- A ready-to-use GitHub Action lives at `.github/workflows/update-transit.yml`; add the `TRANSIT_511_API_KEY` repository secret and it will run weekly on the Hobby tier without additional cost.

## 🔧 Development

### Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `TRANSIT_511_API_KEY` | `.env.local` (gitignored) | 511.org API key for GTFS static + RT feeds |
| `USE_SAMPLE_DATA` | `.env.local` (gitignored) | Set to `true` to serve `sample/` JSON instead of the live 511 API |
| `VITE_API_BASE_URL` | `.env.native` (committed) | Absolute API base URL for native Capacitor builds |

For Vercel production, set `TRANSIT_511_API_KEY` as a server-side environment variable in the Vercel dashboard (no `VITE_` prefix — it must never be exposed to the client).

### Sample / Mock Data

`sample/tripupdates.json` and `sample/alert.json` contain test fixtures covering all GTFS-RT scenarios: on-time, delayed, cancelled, origin/destination skipped, duplicated trips, and service alerts with different `EntitySelector` scopes.

To use them during development, add to `.env.local`:

```
USE_SAMPLE_DATA=true
```

When this flag is set, `npm run dev` intercepts `/api/gtfsrt/*` requests directly in the Vite dev server (no Vercel CLI needed) and returns the local JSON files. Remove the flag (or set it to `false`) to proxy API calls to a local `vercel dev` instance hitting the live 511 API.

### Available Scripts

- `npm run dev` - Start Vite development server (static schedule only, no real-time)
- `npm run dev:vercel` - Start Vercel dev server with real-time API routes on port 3210
- `npm run build` - Build for production web (includes generating `public/data/schedules.json`)
- `npm run build:native` - Build for native iOS/Android (bakes in `VITE_API_BASE_URL` from `.env.native`)
- `npm run update-build` - Refresh from 511.org, then build
- `npm run update-transit` - Refresh schedules from the 511.org GTFS feeds
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run sync` - Build (native mode) and sync to iOS/Android projects
- `npm run sync-live` - Sync with live reload for native development
- `npm run assets` - Generate app icons and splash screens from source images
- `npm run open-ios` - Open iOS project in Xcode
- `npm run open-android` - Open Android project in Android Studio

### Project Structure

```
api/
├── _gtfsrt.ts            # Shared 511.org fetch + protobuf decode helper
└── gtfsrt/
    ├── alerts.ts         # Vercel serverless: service alerts endpoint
    └── tripupdates.ts    # Vercel serverless: trip updates endpoint
src/
├── components/           # React components
│   ├── ui/              # Reusable UI components (shadcn/ui)
│   ├── TrainScheduleApp.tsx  # Main application component
│   ├── ScheduleResults.tsx   # Schedule display
│   ├── TripCard.tsx          # Individual trip row with real-time badges
│   ├── NotificationPanel.tsx # Slide-in service alert drawer
│   ├── ServiceAlert.tsx      # Inline alert banner
│   └── ...
├── data/                # Schedule data
│   ├── generated/       # Auto-generated GTFS snapshots (e.g., trainSchedules.generated.ts)
│   ├── stations.ts      # Station definitions
│   └── trainSchedules.ts # Re-export of generated data
├── hooks/               # React Query polling hooks
│   ├── useServiceAlerts.ts   # Polls /api/gtfsrt/alerts every 5 min
│   ├── useTripUpdates.ts     # Polls /api/gtfsrt/tripupdates every 30 sec
│   └── useNotifications.ts  # Notification read state (localStorage)
├── lib/                 # Utility functions
│   ├── scheduleUtils.ts # Schedule processing logic
│   ├── stationUtils.ts  # Station helpers + GTFS stop ID map
│   ├── env.ts           # Environment variable helpers
│   └── translations/    # i18n string files (en, es)
├── types/               # TypeScript type definitions
│   ├── smartSchedule.ts # Core schedule types
│   ├── gtfsRt.ts        # GTFS-RT response types
│   └── notifications.ts # AppNotification type
└── pages/               # Page components
```

## 📱 Mobile Development

The app uses Capacitor to build native iOS and Android apps from the same codebase. Native builds use `VITE_API_BASE_URL` (set in `.env.native`) so API calls reach the deployed Vercel functions instead of using relative paths.

### Building for Production

```bash
npm run sync          # Build (native mode) and sync to native projects
npm run open-ios      # Open in Xcode
npm run open-android  # Open in Android Studio
```

Then build and run from the native IDE.

### Development with Live Reload

For faster development iteration with live reload on device/simulator:

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. In another terminal, sync with live reload:
   ```bash
   npm run sync-live
   ```

3. Open and run from Xcode or Android Studio. Changes to the web code will appear instantly.

**Note**: `sync-live` auto-detects your Mac's WiFi IP address. Your device/simulator must be on the same network.

### Generating App Icons and Splash Screens

1. Place your source images in the `resources/` folder:
   - `icon.png` (1024x1024) - App icon
   - `splash.png` (2732x2732) - Splash screen

1. Generate all sizes:

   ```bash
   npm run assets
   ```

See `resources/README.md` for more details.

## ♿ Accessibility

This application is built with accessibility in mind:

- Semantic HTML structure
- ARIA labels and descriptions
- Keyboard navigation support
- Screen reader compatibility
- High contrast color schemes
- Focus management

## 📈 Performance

- **Pre-processed Data**: Schedule data is pre-calculated for fast lookups
- **Memoized Components**: React.memo used to prevent unnecessary re-renders
- **Optimized Bundle**: Tree-shaking and code splitting
- **Efficient Algorithms**: O(1) station lookups and optimized filtering
- **Smart Polling**: React Query caches and deduplicates real-time requests; alerts poll every 5 min, trip updates every 30 sec

## 🚧 Future Enhancements

- [ ] Auto-locate nearest station
- [ ] Show time until next train
- [ ] Show time needed to reach next train (walk/bike/drive/transit)
- [ ] User preferences and favorite routes
- [ ] Offline schedule caching
- [ ] Push notifications for service alerts

## 🤝 Contributing

We welcome contributions to improve the SMART Train Schedule application! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Contact

For questions, suggestions, or support:
- App support page: `https://<your-deployed-domain>/support.html`
- Support email: [smart-train@proton.me](mailto:smart-train@proton.me)
- Visit [SMART Train Official Website](https://sonomamarintrain.org/)
- Follow SMART on social media for service updates

---

Built with ❤️ for the SMART Train community
