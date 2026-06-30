# Full Codebase Review — 2026-06-30

Whole-repo review (not a diff). Scope: `src/` (React SPA), `workers/web/` (Cloudflare
Worker + Durable Object push backend), `api/` (shared GTFS-RT logic). Generated data,
`node_modules`, `dist`, and shadcn/ui primitives excluded.

**Overall:** well-built and defensively written — validated inputs, server-only secrets,
no open proxy, escaped SEO HTML, gated/try-caught native bridges, single-source GTFS-RT
decode, no circular deps. **No critical findings.** The real work is the high-severity
perf/robustness items plus a consistent layer of duplication and missing test coverage
around the time/geometry math.

Severity reflects real impact; checkboxes track remediation. Each item lists file:line,
why it matters, and a concrete fix direction.

---

## HIGH

- [ ] **H1 — Mapbox train markers destroyed and rebuilt every 15s poll**
  `src/pages/Map.tsx:347-366`
  Effect unconditionally `marker.remove()` + `new mapboxgl.Marker()` + full
  `createTrainElement()` for every train even when only position changed (`trains` is a
  fresh array each poll). Causes flicker, GC churn, and a re-attached click listener every
  15s while the map is open.
  *Fix:* for existing keys call `marker.setLngLat(...)` and patch color/bearing/selected
  ring in place; only build elements for new keys. Drop `selectedTrainKey`/`handleTrainClick`
  from the deps that force teardown (toggle a CSS class; read train via a ref).

- [ ] **H2 — Unauthenticated Live Activity registration: no rate limit + unbounded epochs**
  `workers/web/src/index.ts:103-139`, `workers/web/src/do/tripActivity.ts:299-312`,
  `src/lib/liveActivityPushTypes.ts:93-96`
  Capability slug protects *existing* activities, but anyone can POST unlimited well-formed
  registrations with fresh random ids, each spinning up a persistent DO with a 90s
  self-rescheduling alarm. `departure/arrivalEpochMs` validated only as finite numbers, so a
  far-future arrival keeps a DO alive indefinitely. DO/alarm/cost exhaustion.
  *Fix:* add a Cloudflare rate-limit rule (or `RateLimit` binding) on `/api/liveactivity/*`;
  bound epochs to ±48h of `now` and require `arrivalEpochMs > departureEpochMs` in
  `isLiveActivityRegistration`.

- [ ] **H3 — Corrupt-but-HTTP-200 feed bytes cached before decode → realtime dark for the window**
  `workers/web/src/lib/gtfsrt.ts:155` (cache write) vs `:165` (`decodeFeed`)
  Raw upstream bytes are cached as last-known-good before decode. A 200 with corrupt
  protobuf (CDN hiccup, HTML error page) poisons the cache; `decodeFeed` throws on every
  call → 502 for clients, `null` for the DO, and 511 isn't re-fetched while "fresh".
  Realtime + Live Activities go dark for the freshness window (30–300s).
  *Fix:* decode before writing to cache (only cache decodable bytes); on decode failure
  treat as a 511 failure — serve prior good bytes / evict the key so the next poll refetches.

- [x] **H4 — Three different definitions of "delayed" across surfaces**
  `src/hooks/useTripUpdates.ts:20` (`MIN_DELAY_SECONDS = 60`),
  `src/hooks/useMapTrains.ts:99` (hardcoded `>= 180`),
  `src/lib/realtimeConstants.ts:7` (`DELAY_MINUTES_THRESHOLD = 3`)
  A train 90s late shows "delayed" in the list but "on time" on map + line diagram. The
  `isDelayed` formula is also copy-pasted verbatim in `mapMarkers.ts:60`,
  `TrainMarker.tsx:55`, `StationInfoSheet.tsx:434`.
  *Fix:* one `isTrainDelayed(train)` helper keyed on a single `DELAY_MINUTES_THRESHOLD`;
  decide the threshold intentionally.

- [ ] **H5 — SmartLineDiagram recomputes SVG path geometry per-train, per-second**
  `src/components/SmartLineDiagram/index.tsx:151,257-280`, `TrainMarker.tsx:44-53`,
  `src/lib/pathSnap.ts`
  `useClockTick(1000)` re-renders every (non-memoized) `TrainMarker` each second, each
  calling `positionOnPath()` → `getTotalLength()` + multiple `getPointAtLength()` (forced
  layout). 30–40 geometry queries/sec with 10+ trains, and it keeps ticking off-screen.
  *Fix:* cache `getTotalLength()` once (path is static after mount); `React.memo`
  `TrainMarker`; gate `useClockTick` on `document.visibilityState`/IntersectionObserver.

---

## MEDIUM

- [ ] **M1 — Trip-updates staleness invisible on non-502 failures**
  `src/hooks/useTripUpdates.ts:353-364`
  Hook surfaces `isUpstreamDown` only for a 502, ignoring `query.isError`. On network loss
  or a 500, react-query keeps last successful `data` → minutes-old data renders as "live"
  with no staleness indicator. (`useVehiclePositions` guards on feed age; this doesn't.)
  *Fix:* surface `isError`/age-vs-freshness so the UI can mark trip-update data stale.

- [ ] **M2 — No timezone pinning in tests; riskiest time/geometry math untested**
  No `vitest.config`/`setupFiles`/`process.env.TZ`. Local-time tests pass only because CI's
  TZ aligns. Untested: `trainMotion.scheduledProgress`, `railProjection.ts`, the `userRiding/`
  state machine (except cold-start fallback), `isTimeInPast`, `getNextTripIndex`/
  `getFirstInProgressTripIndex`.
  *Fix:* pin `TZ=America/Los_Angeles` in a setup file; add overnight + boundary tests for
  `trainMotion`, `railProjection`, and `userRiding` (`boarding`/`release`/`corridor`/correlation).

- [ ] **M3 — `useFocusedTrip.ts` (659 lines) fuses three modules**
  `src/hooks/useFocusedTrip.ts`
  ~400 lines aren't hook code: Live Activity lifecycle (88–325), push registration (102–166),
  standalone `reconcileTripActivities` boot reconciler (327–380). Pure mappers like
  `buildRegistrationForFocus` live in a React file.
  *Fix:* extract `liveActivityController.ts`; leave the hook a thin wrapper. (Same shape in
  `TripDetailContent.tsx`, 634 lines — extract pure selectors + the 90-line debug panel.)

- [ ] **M4 — ErrorBoundary never resets; "Try Again" can loop**
  `src/components/ErrorBoundary.tsx:39-45` (wraps `Routes` in `App.tsx:62`)
  `handleRetry` only flips `hasError=false`; re-rendering the identical tree re-throws. An
  error driven by persisted state (e.g. corrupt station pair) is unrecoverable in-app.
  `componentDidCatch` is console-only.
  *Fix:* reset on `location.pathname` change (key the boundary or `resetKeys`); send errors
  to a real sink.

- [x] **M5 — Pervasive small-helper duplication (DRY)**
  - `formatClockTime` (epoch→locale time) verbatim in `ReminderDialog.tsx:38` &
    `DepartureReminder.tsx:82`, inlined in `FocusedTripCard.tsx:212` & `ServiceAlert.tsx:67`.
  - Local `YYYY-MM-DD` key in `scheduleUtils.ts:318`, `focusedTrip.ts:254`,
    `LiveActivitySync.tsx:15`, `ReminderDialogHost.tsx:13`, `DepartureReminder.tsx:76`,
    `FocusedTripCard.tsx:198`.
  - HH:MM parsing reimplemented instead of `timeUtils` in `focusedTrip.ts:105`,
    `useFocusedTrip.ts:115`, `useTripUpdates.ts:46`, `useTripProgress.ts:246`,
    `FerryConnection.tsx:38`, `RoutePairLandingPage.tsx:45`.
  - `serviceDate→weekday` in `TripDetailContent.tsx:101` & `FocusedTripCard.tsx:201`.
  *Fix:* one helper each in `timeUtils.ts` (`formatClockTime`, `toLocalDateKey`,
  `parseServiceDate`, `serviceDateWeekdayLabel`); reuse everywhere.
  *Done:* added the four `timeUtils` helpers (+ tests) and `isTrainDelayed`; wired all
  consumers. Two deliberate leave-as-is: `ServiceAlert.tsx:67` (no `timeFormat` in scope —
  it intentionally uses the locale default, not the 12/24h preference) and
  `RoutePairLandingPage.tsx:45` (SEO prerender path, kept isolated from the client lib).

- [x] **M6 — `useCountdown` interval recreated every tick, never usefully fires**
  `src/hooks/useCountdown.ts:17-24`
  `currentTime` is both a dep and captured in the `setInterval` closure, so each parent tick
  rebuilds the 10s interval before it fires; the value only advances via the effect body.
  *Fix:* drop the interval and derive from the `currentTime` prop, or read `Date.now()`
  inside a stable interval.

- [ ] **M7 — `unixToTimeString` / `scheduledHHMMtoUnix` use device-local TZ, not Pacific**
  `src/hooks/useTripUpdates.ts:27-48`
  Convert via device-local `getHours()`/`new Date(y,m,d,h,m)`. In-region offsets cancel; an
  off-Pacific phone shifts live times and delays by the offset. Latent but real.
  *Fix:* pin conversions to `America/Los_Angeles` via `Intl.DateTimeFormat({ timeZone })`.

---

## LOW

- [ ] **L1 — `ThemeProvider` context value not memoized** — `src/components/ThemeProvider.tsx:59-65`:
  `{theme,setTheme}` is a fresh object each render; latent wide re-render of `useTheme()`
  consumers. Wrap in `useMemo`/`useCallback`.
- [ ] **L2 — Clock timers don't pause when tab hidden** — `useNow.ts`,
  `SmartLineDiagram/useClockTick.ts`, `useCountdown.ts` keep firing in background. Copy the
  visibility guard already in `TrainScheduleApp.tsx:79`.
- [ ] **L3 — `useUserPreferences` spreads parsed JSON without shape validation** —
  `src/hooks/useUserPreferences.ts:26-34`: a tampered `selectedFareType` flows into
  `calculateFare` → `undefined` deref. Validate fields like `useDismissedAlerts.ts:27`.
- [ ] **L4 — APNs device token not hex-validated, interpolated raw into URL path** —
  `workers/web/src/lib/apns.ts:154`, validated only as a bounded string at
  `liveActivityPushTypes.ts:112`. Can't escape the host, but `?`/`#`/`../` alter the path.
  Validate `/^[0-9a-fA-F]{64,200}$/` or `encodeURIComponent`.
- [ ] **L5 — Lost alternate-train swap when latch release fires the same tick** —
  `src/hooks/useUserRiding.ts:108-127`: release check runs against the *old* `ridingTrainKey`,
  clobbering a just-set alternate; briefly drops "riding". Compute the effective key first.
- [ ] **L6 — `getClosestStationWithDistance` returns `stations[0]` for `NaN` coords** —
  `src/lib/stationUtils.ts:127-142`: callers guard with `Number.isFinite`, but it's a
  foot-gun. Early-return on non-finite input.
- [ ] **L7 — `isTimeInPast` overnight blind spot** — `src/lib/timeUtils.ts:63-74`: no day
  rollover. Non-triggering for trains (no post-midnight service) but feeds ferry logic and
  `getNextTripIndex`. Document/decide intended behavior.
- [ ] **L8 — Wildcard CORS on mutation routes** — `workers/web/src/index.ts:32-37`: by-design,
  not exploitable given the capability model; optionally scope `/api/liveactivity/*` to known
  origins.
- [ ] **L9 — Stale comments / dead code** — `workers/web/src/lib/gtfsrt.ts:171,228` reference
  deleted `api/gtfsrt/*`; `src/types/gtfsRt.ts:98` `warnings` is unpopulated;
  `calculateTimeDifference` (`timeUtils.ts:37`) is an unused export.
- [ ] **L10 — Web reminders lost on tab close** — `src/lib/notificationScheduler.ts:55-95`:
  in-memory `setTimeout`s don't survive reload (mitigated by boot re-arm in `App.tsx:50`).
  Inherent to web; note for awareness.

---

## Suggested order

1. Cheap high-value: **H4** (single delay threshold), **M5** (DRY helpers), **M6** (useCountdown).
2. Robustness: **H3** (decode-before-cache), **M1** (staleness), **H2** (rate limit + epoch bounds).
3. Perf: **H1** (mapbox markers), **H5** (diagram geometry), **L1/L2** (memo + visibility).
4. Test foundation: **M2** (TZ pinning) first, then overnight/boundary tests as other fixes land.
5. Structural: **M3** (extract liveActivityController), **M4** (ErrorBoundary reset).
