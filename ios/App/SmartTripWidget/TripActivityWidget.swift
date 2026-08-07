import ActivityKit
import SwiftUI
import WidgetKit

/**
 * The focused-trip Live Activity. The lock screen and expanded Dynamic Island
 * intentionally share the same compact hierarchy: brand + active clock time, an
 * alarm → walk → train timeline with system-managed progress segments and
 * milestone icons, then the live countdown beside the destination. All
 * content arrives via
 * `GenericAttributes` from the app/server (see TripActivityModel).
 *
 * The headline countdown advances through three stages (see `CountdownStage`):
 * while a leave alarm is armed and still ahead it counts down to the *alarm*
 * ("Leave in"); once that fires it flips to the *departure* ("Depart in"); and
 * once the train leaves it counts down to *arrival*. On the lock screen and
 * expanded island this uses SwiftUI's self-updating
 * `Text(timerInterval:countsDown:)` (see `RelativeCountdown`). Crucially that
 * timer CLAMPS at 0:00 once the
 * target passes — it never counts *up*. A local (non-push) activity gets no
 * re-render at the stage/arrival boundary while the app is backgrounded, and the
 * earlier `.relative` style kept ticking *upward* past the target there, so the
 * lock screen / expanded island showed an ever-growing "2 min, 30 sec" of
 * elapsed time instead of holding at zero. The compact island pairs the same
 * clamping timer with a stage-matched glyph (see `CompactLeadingIcon`): a walking
 * person to the alarm, the train to departure, then a map pin to the
 * destination en route.
 */
struct TripActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GenericAttributes.self) { context in
            let model = TripActivityModel(context: context)
            LockScreenView(model: model, isStale: context.isStale)
                .activityBackgroundTint(statusColor(model))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let model = TripActivityModel(context: context)
            let accent = statusColor(model)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(Brand.name)
                    } icon: {
                        TrainIcon(size: 14).foregroundStyle(accent)
                    }
                    .font(.caption.weight(.semibold))
                    .padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ActiveEventClock(
                        model: model,
                        primaryColor: .white,
                        secondaryColor: .secondary
                    )
                        .padding(.trailing, 8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    JourneyProgressAndTiming(
                        model: model,
                        completedColor: accent,
                        walkingColor: accent,
                        markerFill: accent,
                        primaryColor: .white,
                        secondaryColor: .secondary
                    )
                    .padding(.horizontal, 8)
                    .padding(.top, 2)
                }
            } compactLeading: {
                CompactLeadingIcon(model: model, accent: accent)
            } compactTrailing: {
                CompactCountdown(model: model)
            } minimal: {
                // Stage-aware (walk → train → map pin), same as the compact
                // leading slot — so a trip pushed to the tiny minimal slot (e.g.
                // another app holds the primary island) still shows the map pin
                // once en route instead of a frozen train.
                CompactLeadingIcon(model: model, accent: accent)
            }
            .keylineTint(accent)
        }
    }
}

private enum Brand {
    /// The app's display name (`CFBundleDisplayName`). Shown as the wordmark on
    /// the lock screen and Dynamic Island.
    static let name = "SMART trip"
    /// The app's "My Trip" blue — keep in sync with `--my-trip-background`
    /// (211 75% 48%) in src/index.css.
    static let blue = Color(red: 0.12, green: 0.47, blue: 0.84)
    /// "Running late" gold — mirrors `--smart-gold` (36 69% 54%) in src/index.css.
    static let gold = Color(red: 216.0 / 255.0, green: 146.0 / 255.0, blue: 63.0 / 255.0)
    /// Cancelled red — mirrors `--destructive` (0 84% 60%) in src/index.css.
    static let red = Color(red: 0.937, green: 0.267, blue: 0.267)
}

/// The three stages the headline countdown moves through before arrival.
private enum CountdownStage { case alarm, departure, arrival }

/// The active stage, derived from the widget's OWN clock against the target
/// instants in the payload — NOT the app-pushed `phase` / `alarmPending` flags.
///
/// A local (non-push) activity receives no content update while the app is
/// backgrounded, so keying the stage purely off the pushed flags froze it: once
/// departure passed with the app not foreground to push the flip, the compact
/// timer sat at 0:00 instead of advancing to the destination countdown. The
/// pushed instants remain the source of truth (realtime delay moves them); the
/// clock just picks which one is active, so the stage self-advances on the next
/// system re-render (screen-on, unlock, periodic refresh) with no push needed.
/// `now` is a parameter so previews/tests can pin it.
private func countdownStage(_ model: TripActivityModel, now: Date = Date()) -> CountdownStage {
    if model.reminderSet, let reminder = model.reminderDate, now < reminder {
        return .alarm
    }
    if let departure = model.departureDate, now < departure {
        return .departure
    }
    return .arrival
}

/// The instant the active stage's countdown ticks down to.
private func countdownTarget(_ model: TripActivityModel) -> Date? {
    switch countdownStage(model) {
    case .alarm: return model.reminderDate
    case .departure: return model.departureDate
    case .arrival: return model.arrivalDate
    }
}

/// Whether the trip has concluded — the app's pushed `isEnded`, OR the widget's
/// OWN clock has passed arrival. A local (non-push) activity gets no `isEnded`
/// push while the app is backgrounded, so without the clock fallback the surfaces
/// sat on the destination countdown frozen at 0:00 after arrival until a
/// foreground reconcile (or iOS expiry) finally cleared the activity. Deriving it
/// here renders a clean "Arrived" terminal state in the meantime. `now` is a
/// parameter so previews/tests can pin it.
private func isArrived(_ model: TripActivityModel, now: Date = Date()) -> Bool {
    if model.isEnded { return true }
    guard let arrival = model.arrivalDate else { return false }
    return now >= arrival
}

/// Status-driven accent: blue when on time, the brand delay gold when late,
/// red when cancelled. Drives the lock-screen background tint and every Dynamic
/// Island accent so the status colour reads the same on both surfaces. Mirrors
/// the precedence in `deriveStatusText` (cancelled > ended > delayed).
private func statusColor(_ model: TripActivityModel) -> Color {
    if model.isCanceled { return Brand.red }
    if isArrived(model) { return Brand.blue }
    if model.delayMinutes > 0 { return Brand.gold }
    return Brand.blue
}

/// The SMART brand train icon (front view), drawn as a vector so the widget
/// needs no asset catalog of its own. The path data is copied verbatim from the
/// web app's `TRIP_ICON_PATH` in src/components/icons/TripIcon.tsx — keep the
/// two in lockstep if the artwork ever changes.
private struct TrainIcon: View {
    /// Rendered square size, in points.
    var size: CGFloat
    /// Stroke weight as a fraction of `size`; ~0.083 mirrors the icon's
    /// lucide-style 2/24 stroke ratio on the web.
    var strokeRatio: CGFloat = 0.083

    var body: some View {
        TrainIconShape()
            .stroke(
                style: StrokeStyle(
                    lineWidth: size * strokeRatio,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
    }
}

/// Stroked `Shape` form of `TripIconArt.path`, scaled to fit and centered in
/// whatever rect SwiftUI proposes.
private struct TrainIconShape: Shape {
    private static let viewBox: CGFloat = 512
    private static let base = SVGPath.parse(TripIconArt.path)

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / Self.viewBox
        let side = Self.viewBox * scale
        let transform = CGAffineTransform(
            translationX: rect.midX - side / 2,
            y: rect.midY - side / 2
        ).scaledBy(x: scale, y: scale)
        return Self.base.applying(transform)
    }
}

private enum TripIconArt {
    /// 512×512 front-view train. Mirror of `TRIP_ICON_PATH` in
    /// src/components/icons/TripIcon.tsx.
    static let path =
        "M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308"
}

/// Minimal SVG-path parser for the absolute M/L/H/V/C/Z subset the brand icon
/// uses. Purpose-built for `TripIconArt` — not a general-purpose parser.
private enum SVGPath {
    static func parse(_ string: String) -> Path {
        var path = Path()
        var scanner = PathScanner(string)
        var current = CGPoint.zero
        var start = CGPoint.zero

        while let command = scanner.nextCommand() {
            switch command {
            case "M":
                current = scanner.point()
                start = current
                path.move(to: current)
                while scanner.hasNumber {
                    current = scanner.point()
                    path.addLine(to: current)
                }
            case "L":
                while scanner.hasNumber {
                    current = scanner.point()
                    path.addLine(to: current)
                }
            case "H":
                while scanner.hasNumber {
                    current.x = scanner.number()
                    path.addLine(to: current)
                }
            case "V":
                while scanner.hasNumber {
                    current.y = scanner.number()
                    path.addLine(to: current)
                }
            case "C":
                while scanner.hasNumber {
                    let control1 = scanner.point()
                    let control2 = scanner.point()
                    current = scanner.point()
                    path.addCurve(to: current, control1: control1, control2: control2)
                }
            case "Z", "z":
                path.closeSubpath()
                current = start
            default:
                return path
            }
        }
        return path
    }

    /// Character cursor over the path string; reads commands and numbers.
    private struct PathScanner {
        private let chars: [Character]
        private var index = 0

        init(_ string: String) { chars = Array(string) }

        /// True if the next token (past separators) begins a number.
        var hasNumber: Bool {
            var probe = index
            while probe < chars.count, Self.isSeparator(chars[probe]) { probe += 1 }
            guard probe < chars.count else { return false }
            let c = chars[probe]
            return Self.isDigit(c) || c == "." || c == "-" || c == "+"
        }

        mutating func nextCommand() -> Character? {
            skipSeparators()
            guard index < chars.count else { return nil }
            let c = chars[index]
            guard c.isLetter else { return nil }
            index += 1
            return c
        }

        mutating func point() -> CGPoint {
            CGPoint(x: number(), y: number())
        }

        mutating func number() -> CGFloat {
            skipSeparators()
            var token = ""
            if index < chars.count, chars[index] == "-" || chars[index] == "+" {
                token.append(chars[index]); index += 1
            }
            while index < chars.count {
                let c = chars[index]
                if Self.isDigit(c) || c == "." {
                    token.append(c); index += 1
                } else if c == "e" || c == "E" {
                    token.append(c); index += 1
                    if index < chars.count, chars[index] == "-" || chars[index] == "+" {
                        token.append(chars[index]); index += 1
                    }
                } else {
                    break
                }
            }
            return CGFloat(Double(token) ?? 0)
        }

        private mutating func skipSeparators() {
            while index < chars.count, Self.isSeparator(chars[index]) { index += 1 }
        }

        private static func isSeparator(_ c: Character) -> Bool {
            c == " " || c == "," || c == "\n" || c == "\t" || c == "\r"
        }

        private static func isDigit(_ c: Character) -> Bool {
            c >= "0" && c <= "9"
        }
    }
}

/// The Lucide `bell-ring` glyph — a bell with two ring lines at the top —
/// drawn as a vector so the "reminder armed" badge matches the web app's icon
/// exactly. SF Symbols' bells don't carry the ring lines. Stroked like
/// `TrainIcon`; mirror of lucide-react's `BellRing` (keep in lockstep).
private struct BellRingIcon: View {
    var size: CGFloat
    var strokeRatio: CGFloat = 0.083

    var body: some View {
        BellRingIconShape()
            .stroke(
                style: StrokeStyle(
                    lineWidth: size * strokeRatio,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
    }
}

/// `bell-ring` outline in lucide's 24×24 viewBox, scaled to fit the proposed
/// rect (same fit math as `TrainIconShape`). Lucide draws it with circular
/// arcs, so `arc(...)` reconstructs each as ≤90° cubic segments.
private struct BellRingIconShape: Shape {
    private static let viewBox: CGFloat = 24

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / Self.viewBox
        let side = Self.viewBox * scale
        let dx = rect.midX - side / 2
        let dy = rect.midY - side / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: dx + x * scale, y: dy + y * scale)
        }

        var path = Path()

        // Clapper: M10.268 21 a2 2 0 0 0 3.464 0
        path.move(to: pt(10.268, 21))
        appendSVGArc(&path, to: pt(13.732, 21), radius: 2 * scale, largeArc: false, sweep: false)

        // Right ring line: M22 8 c0 -2.3 -.8 -4.3 -2 -6
        path.move(to: pt(22, 8))
        path.addCurve(to: pt(20, 2), control1: pt(22, 5.7), control2: pt(21.2, 3.7))

        // Bell body (base corners + dome)
        path.move(to: pt(3.262, 15.326))
        appendSVGArc(&path, to: pt(4, 17), radius: 1 * scale, largeArc: false, sweep: false)
        path.addLine(to: pt(20, 17))
        appendSVGArc(&path, to: pt(20.74, 15.327), radius: 1 * scale, largeArc: false, sweep: false)
        path.addCurve(to: pt(18, 8), control1: pt(19.41, 13.956), control2: pt(18, 12.499))
        appendSVGArc(&path, to: pt(6, 8), radius: 6 * scale, largeArc: false, sweep: false)
        path.addCurve(to: pt(3.262, 15.326), control1: pt(6, 12.499), control2: pt(4.589, 13.956))

        // Left ring line: M4 2 C2.8 3.7 2 5.7 2 8
        path.move(to: pt(4, 2))
        path.addCurve(to: pt(2, 8), control1: pt(2.8, 3.7), control2: pt(2, 5.7))

        return path
    }

}

/// Append a circular arc (lucide uses rx == ry, no rotation) from the path's
/// current point to `end`, approximated with ≤90° cubic segments. `largeArc` /
/// `sweep` follow SVG arc-flag semantics. Shared by the lucide-derived icon
/// shapes (bell-ring, map-pin).
private func appendSVGArc(_ path: inout Path, to end: CGPoint, radius: CGFloat,
                          largeArc: Bool, sweep: Bool) {
    let start = path.currentPoint ?? end
    let halfDx = (start.x - end.x) / 2
    let halfDy = (start.y - end.y) / 2
    let dist = (halfDx * halfDx + halfDy * halfDy).squareRoot()
    if dist == 0 { return }
    let r = max(radius, dist)
    let h = (r * r - dist * dist).squareRoot()
    let mx = (start.x + end.x) / 2
    let my = (start.y + end.y) / 2
    let ux = (end.x - start.x) / (2 * dist)
    let uy = (end.y - start.y) / (2 * dist)
    let sign: CGFloat = (largeArc != sweep) ? 1 : -1
    let cx = mx + sign * h * (-uy)
    let cy = my + sign * h * ux
    var a0 = atan2(start.y - cy, start.x - cx)
    let a1 = atan2(end.y - cy, end.x - cx)
    var delta = a1 - a0
    if sweep && delta < 0 { delta += 2 * .pi }
    if !sweep && delta > 0 { delta -= 2 * .pi }
    let segCount = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
    let segAngle = delta / CGFloat(segCount)
    let k = (4.0 / 3.0) * tan(segAngle / 4) * r
    var current = start
    for _ in 0..<segCount {
        let a2 = a0 + segAngle
        let p2 = CGPoint(x: cx + r * cos(a2), y: cy + r * sin(a2))
        let t0 = CGPoint(x: -sin(a0), y: cos(a0))
        let t2 = CGPoint(x: -sin(a2), y: cos(a2))
        let c1 = CGPoint(x: current.x + k * t0.x, y: current.y + k * t0.y)
        let c2 = CGPoint(x: p2.x - k * t2.x, y: p2.y - k * t2.y)
        path.addCurve(to: p2, control1: c1, control2: c2)
        current = p2
        a0 = a2
    }
}

/// The SMART/lucide `map-pin` glyph — a teardrop pin with a hole — for the "to
/// destination" stage on the compact island, matching the home card's MapPin.
/// Drawn as a vector so it matches the web app exactly; mirror of lucide-react's
/// `MapPin` (keep in lockstep). Stroked like `TrainIcon`.
private struct MapPinIcon: View {
    var size: CGFloat
    var strokeRatio: CGFloat = 0.083

    var body: some View {
        MapPinIconShape()
            .stroke(
                style: StrokeStyle(
                    lineWidth: size * strokeRatio,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
    }
}

/// `map-pin` outline in lucide's 24×24 viewBox, scaled to fit the proposed rect
/// (same fit math as `TrainIconShape`). The pin body mixes cubic curves with two
/// circular arcs (the rounded bottom tip and the domed top), reconstructed via
/// `appendSVGArc`; the inner hole is a plain circle.
private struct MapPinIconShape: Shape {
    private static let viewBox: CGFloat = 24

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / Self.viewBox
        let side = Self.viewBox * scale
        let dx = rect.midX - side / 2
        let dy = rect.midY - side / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: dx + x * scale, y: dy + y * scale)
        }

        var path = Path()

        // Pin body: M20 10 c0 4.993 -5.539 10.193 -7.399 11.799
        //           a1 1 0 0 1 -1.202 0
        //           C9.539 20.193 4 14.993 4 10 a8 8 0 0 1 16 0
        path.move(to: pt(20, 10))
        path.addCurve(to: pt(12.601, 21.799), control1: pt(20, 14.993), control2: pt(14.461, 20.193))
        appendSVGArc(&path, to: pt(11.399, 21.799), radius: 1 * scale, largeArc: false, sweep: true)
        path.addCurve(to: pt(4, 10), control1: pt(9.539, 20.193), control2: pt(4, 14.993))
        appendSVGArc(&path, to: pt(20, 10), radius: 8 * scale, largeArc: false, sweep: true)

        // Inner hole: circle cx 12 cy 10 r 3.
        let r = 3 * scale
        let center = pt(12, 10)
        path.addEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r))

        return path
    }
}

/// A walking-person glyph for the "time to leave" stage on the compact island —
/// a head over striding legs + arms. Drawn as a vector (not an SF Symbol) so it
/// matches the web app's `WalkIcon` exactly; mirror of Tabler Icons' `walk`
/// (MIT). Stroked like `TrainIcon`; keep in lockstep with the web component.
private struct WalkIcon: View {
    var size: CGFloat
    var strokeRatio: CGFloat = 0.083

    var body: some View {
        WalkIconShape()
            .stroke(
                style: StrokeStyle(
                    lineWidth: size * strokeRatio,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
    }
}

/// `walk` outline in Tabler's 24×24 viewBox, scaled to fit the proposed rect
/// (same fit math as `TrainIconShape`). The figure is a small head circle plus
/// three open polylines (back leg, front leg + torso, arms), so unlike the
/// bell it needs no arc reconstruction — just straight segments.
private struct WalkIconShape: Shape {
    private static let viewBox: CGFloat = 24

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / Self.viewBox
        let side = Self.viewBox * scale
        let dx = rect.midX - side / 2
        let dy = rect.midY - side / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: dx + x * scale, y: dy + y * scale)
        }

        var path = Path()

        // Head: circle cx 13 cy 4 r 1.
        let r = 1 * scale
        let head = pt(13, 4)
        path.addEllipse(in: CGRect(x: head.x - r, y: head.y - r, width: 2 * r, height: 2 * r))

        // Back leg: M7 21 l3 -4
        path.move(to: pt(7, 21))
        path.addLine(to: pt(10, 17))

        // Front leg + torso: M16 21 l-2 -4 l-3 -3 l1 -6
        path.move(to: pt(16, 21))
        path.addLine(to: pt(14, 17))
        path.addLine(to: pt(11, 14))
        path.addLine(to: pt(12, 8))

        // Arms across the chest: M6 12 l2 -3 l4 -1 l3 3 l3 1
        path.move(to: pt(6, 12))
        path.addLine(to: pt(8, 9))
        path.addLine(to: pt(12, 8))
        path.addLine(to: pt(15, 11))
        path.addLine(to: pt(18, 12))

        return path
    }
}

/// Compact-leading glyph: tracks the active countdown stage so the icon always
/// matches the timer beside it (and the home card) — a walking person to the
/// leave alarm, the brand train to departure, then a map pin to the destination
/// once en route.
private struct CompactLeadingIcon: View {
    let model: TripActivityModel
    let accent: Color

    @ViewBuilder
    var body: some View {
        Group {
            switch countdownStage(model) {
            case .alarm: WalkIcon(size: 20)
            case .departure: TrainIcon(size: 20)
            case .arrival: MapPinIcon(size: 20)
            }
        }
        .foregroundStyle(accent)
        .padding(.horizontal, 2)
    }
}

/// Compact-trailing variant: a digital countdown to whichever instant the active
/// stage targets (alarm → departure → arrival), or a terminal symbol once
/// cancelled/arrived. Keep this aggressively narrow; if compact content asks for
/// too much width, iOS inflates the island into the wide presentation.
private struct CompactCountdown: View {
    let model: TripActivityModel

    @ViewBuilder
    var body: some View {
        if model.isCanceled {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        } else if isArrived(model) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.blue)
        } else if let target = countdownTarget(model) {
            DigitalTimer(target: target)
        } else {
            EmptyView()
        }
    }
}

/// Native ActivityKit-friendly countdown with seconds visible. The secondless
/// variants fought the compact island host too much; this keeps the reliable
/// self-updating timer and constrains its visual footprint. Uses `maxWidth`
/// (not a fixed width) so it shrinks to the compact-trailing slot rather than
/// overflowing it — a fixed width wider than the slot collapses the trailing to
/// nothing (the "empty second bubble" on the compact island).
private struct DigitalTimer: View {
    let target: Date

    var body: some View {
        let now = Date()
        Group {
            if target <= now {
                Text("NOW")
            } else {
                Text(timerInterval: now...target, countsDown: true)
            }
        }
        .font(.system(size: 16, weight: .bold))
        .monospacedDigit()
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: 52, alignment: .trailing)
        .accessibilityLabel(Text(target, style: .timer))
    }
}

/// Live countdown for the active stage (alarm → departure → arrival) via
/// SwiftUI's self-updating `Text(timerInterval:countsDown:)` — ticks down
/// natively with no push and CLAMPS at 0:00 once the target passes, so it never
/// counts up. (The earlier `.relative` style kept counting *up* past the target
/// whenever a stage boundary or arrival elapsed while the app was backgrounded
/// and no re-render fired to advance the stage, so the lock screen / expanded
/// island showed an ever-growing elapsed time instead of holding at zero.) Used
/// on the roomy surfaces (lock screen + expanded island); the compact pill uses
/// the same clamping timer at a narrower width. "—" when the stage's instant is
/// missing; callers handle the cancelled/arrived states.
private struct RelativeCountdown: View {
    let model: TripActivityModel

    var body: some View {
        let now = Date()
        if let target = countdownTarget(model) {
            if target > now {
                Text(timerInterval: now...target, countsDown: true)
                    .monospacedDigit()
            } else {
                // Target already elapsed with no re-render to flip the parent to
                // its "Arrived" terminal word yet — hold at zero, never count up.
                Text("0:00").monospacedDigit()
            }
        } else {
            Text("—")
        }
    }
}

/// The shared compact body used verbatim by the lock screen and expanded
/// Dynamic Island: segmented timeline first, active countdown + destination
/// directly below. Keeping the surfaces on one component prevents their
/// heights and information hierarchy from drifting apart again.
private struct JourneyProgressAndTiming: View {
    let model: TripActivityModel
    let completedColor: Color
    let walkingColor: Color
    let markerFill: Color
    let primaryColor: Color
    let secondaryColor: Color

    var body: some View {
        VStack(spacing: 5) {
            if !model.isCanceled {
                TripProgressTrack(
                    model: model,
                    alarmColor: completedColor.opacity(0.72),
                    walkingColor: walkingColor,
                    trainColor: markerFill,
                    iconColor: primaryColor
                )
            }

            ActiveEventTimingRow(
                model: model,
                primaryColor: primaryColor,
                secondaryColor: secondaryColor
            )
        }
    }
}

/// "Arrives in 37 min                       Larkspur" — the live countdown
/// leads on the left while the larger destination gets the roomier trailing
/// position formerly occupied by the absolute time.
private struct ActiveEventTimingRow: View {
    let model: TripActivityModel
    let primaryColor: Color
    let secondaryColor: Color

    var body: some View {
        GeometryReader { geometry in
            let gap: CGFloat = 6
            let countdownWidth = min(156, max(144, geometry.size.width * 0.46))
            let destinationWidth = max(0, geometry.size.width - countdownWidth - gap)

            HStack(alignment: .firstTextBaseline, spacing: gap) {
                Group {
                    if model.isCanceled {
                        Text("Cancelled")
                    } else if isArrived(model) {
                        Text("Arrived")
                    } else {
                        HStack(spacing: 4) {
                            Text("\(activeEventLabel) in")
                                .foregroundStyle(secondaryColor)
                                .lineLimit(1)
                                .minimumScaleFactor(0.78)
                                .layoutPriority(1)
                            RelativeCountdown(model: model)
                                .monospacedDigit()
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
                }
                .font(.system(size: 17, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(width: countdownWidth, alignment: .leading)

                Text(model.toStation)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: destinationWidth, alignment: .trailing)
            }
            .foregroundStyle(primaryColor)
        }
        .frame(height: 22)
    }

    private var activeEventLabel: String {
        switch countdownStage(model) {
        case .alarm: return "Leave"
        case .departure: return "Departs"
        case .arrival: return "Arrives"
        }
    }

}

/// Small absolute time in the upper-right header. The leading "at" keeps a bare
/// clock value from reading like the current time; the phase-specific action is
/// supplied by the larger countdown row directly below.
private struct ActiveEventClock: View {
    let model: TripActivityModel
    let primaryColor: Color
    let secondaryColor: Color

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            HStack(spacing: 3) {
                Text("at").foregroundStyle(secondaryColor)
                if let date = countdownTarget(model) {
                    Text(date, style: .time)
                } else {
                    Text("—")
                }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(primaryColor)
            .lineLimit(1)
        }
    }
}

/// Three native, date-relative progress bars: time to the leave alarm, walking
/// to the station, then riding the train. SwiftUI advances each segment from its
/// date interval without requiring the widget extension to run a periodic
/// timeline. Widths remain proportional to the real stage durations, with a
/// small minimum for short stages. Bell → walker → train → destination
/// icons label the four boundaries above the bars.
private struct TripProgressTrack: View {
    let model: TripActivityModel
    let alarmColor: Color
    let walkingColor: Color
    let trainColor: Color
    let iconColor: Color

    private let alarmLeadTime: TimeInterval = 60 * 60
    private let minimumSegmentWidth: CGFloat = 20
    private let iconSize: CGFloat = 12
    private let walkingIconSize: CGFloat = 15
    private let segmentGap: CGFloat = 4
    private let trackHeight: CGFloat = 30

    var body: some View {
        GeometryReader { geometry in
            let hasReminderJourney: Bool = {
                guard model.reminderSet,
                      let reminder = model.reminderDate,
                      let departure = model.departureDate else { return false }
                return reminder < departure
            }()
            let gapCount: CGFloat = hasReminderJourney ? 2 : 0
            let availableWidth = max(0, geometry.size.width - segmentGap * gapCount)
            let values = segmentValues(trackWidth: availableWidth)

            ZStack(alignment: .topLeading) {
                HStack(spacing: values.hasReminderJourney ? segmentGap : 0) {
                    if values.hasReminderJourney,
                       let progressStart = values.progressStart,
                       let reminder = values.reminder {
                        NativeTimerProgress(
                            start: progressStart,
                            end: reminder,
                            color: alarmColor
                        )
                        .frame(width: values.widths[0])

                        NativeTimerProgress(
                            start: reminder,
                            end: values.departure,
                            color: walkingColor
                        )
                        .frame(width: values.widths[1])
                    }

                    NativeTimerProgress(
                        start: values.departure,
                        end: values.arrival,
                        color: trainColor
                    )
                    .frame(width: values.widths[2])
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 17)

                if values.hasReminderJourney {
                    milestoneIcon(.alarm, x: 0, totalWidth: geometry.size.width)
                    milestoneIcon(
                        .walking,
                        x: values.widths[0] + segmentGap / 2,
                        totalWidth: geometry.size.width
                    )
                    milestoneIcon(
                        .train,
                        x: values.widths[0] + segmentGap + values.widths[1] + segmentGap / 2,
                        totalWidth: geometry.size.width
                    )
                } else {
                    milestoneIcon(.train, x: 0, totalWidth: geometry.size.width)
                }
                milestoneIcon(.arrival, x: geometry.size.width, totalWidth: geometry.size.width)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(
                values.hasReminderJourney
                    ? "Trip progress: alarm, walk, and train"
                    : "Train trip progress"
            ))
        }
        .frame(height: trackHeight)
    }

    private struct SegmentValues {
        let widths: [CGFloat]
        let hasReminderJourney: Bool
        let progressStart: Date?
        let reminder: Date?
        let departure: Date
        let arrival: Date
    }

    private enum ProgressPhase {
        case alarm, walking, train, arrival
    }

    private struct ProgressMilestoneIcon: View {
        let phase: ProgressPhase
        let size: CGFloat

        @ViewBuilder
        var body: some View {
            switch phase {
            case .alarm: BellRingIcon(size: size, strokeRatio: 0.1)
            case .walking: WalkIcon(size: size, strokeRatio: 0.1)
            case .train: TrainIcon(size: size, strokeRatio: 0.1)
            case .arrival: MapPinIcon(size: size, strokeRatio: 0.1)
            }
        }
    }

    private struct NativeTimerProgress: View {
        let start: Date
        let end: Date
        let color: Color

        var body: some View {
            ProgressView(timerInterval: start...end, countsDown: false)
                .tint(color)
                .labelsHidden()
        }
    }

    private func milestoneIcon(
        _ phase: ProgressPhase,
        x: CGFloat,
        totalWidth: CGFloat
    ) -> some View {
        let renderedSize: CGFloat
        switch phase {
        case .walking:
            renderedSize = walkingIconSize
        default:
            renderedSize = iconSize
        }
        let inset = renderedSize / 2
        let clampedX = min(max(x, inset), max(inset, totalWidth - inset))
        return ProgressMilestoneIcon(phase: phase, size: renderedSize)
            .foregroundStyle(iconColor)
            .position(x: clampedX, y: walkingIconSize / 2)
    }

    private func segmentValues(trackWidth: CGFloat) -> SegmentValues {
        guard let departure = model.departureDate,
              let arrival = model.arrivalDate,
              arrival > departure else {
            let now = Date()
            return SegmentValues(
                widths: [0, 0, trackWidth],
                hasReminderJourney: false,
                progressStart: nil,
                reminder: nil,
                departure: now,
                arrival: now.addingTimeInterval(1)
            )
        }

        let reminder = model.reminderSet ? model.reminderDate : nil
        let hasReminderJourney = reminder.map { $0 < departure } ?? false
        let progressStart: Date?
        let widths: [CGFloat]
        if hasReminderJourney, let reminder {
            let start = min(
                model.timelineStartDate ?? reminder.addingTimeInterval(-alarmLeadTime),
                reminder.addingTimeInterval(-1)
            )
            progressStart = start
            widths = proportionalWidths(
                durations: [
                    max(0, reminder.timeIntervalSince(start)),
                    departure.timeIntervalSince(reminder),
                    arrival.timeIntervalSince(departure),
                ],
                trackWidth: trackWidth
            )
        } else {
            progressStart = nil
            widths = [0, 0, trackWidth]
        }

        return SegmentValues(
            widths: widths,
            hasReminderJourney: hasReminderJourney,
            progressStart: progressStart,
            reminder: reminder,
            departure: departure,
            arrival: arrival
        )
    }

    /// Allocate the available width proportionally, then clamp only genuinely
    /// short stages to a compact readable minimum and redistribute the rest
    /// among the longer stages. This preserves duration truth without letting a
    /// short walk or alarm become too narrow to recognize.
    private func proportionalWidths(
        durations: [TimeInterval],
        trackWidth: CGFloat
    ) -> [CGFloat] {
        guard !durations.isEmpty, trackWidth > 0 else { return [0, 0, max(0, trackWidth)] }

        let positiveDurations = durations.map { max(0, $0) }
        let minimumWidth = min(minimumSegmentWidth, trackWidth / CGFloat(durations.count))
        var widths = Array(repeating: CGFloat.zero, count: durations.count)
        var remaining = Array(durations.indices)
        var remainingWidth = trackWidth
        var remainingDuration = positiveDurations.reduce(0, +)

        while !remaining.isEmpty {
            let tooShort = remaining.filter { index in
                let proposed = remainingDuration > 0
                    ? remainingWidth * CGFloat(positiveDurations[index] / remainingDuration)
                    : remainingWidth / CGFloat(remaining.count)
                return proposed < minimumWidth
            }
            if tooShort.isEmpty { break }

            for index in tooShort {
                widths[index] = minimumWidth
                remainingWidth -= minimumWidth
                remainingDuration -= positiveDurations[index]
            }
            remaining.removeAll { tooShort.contains($0) }
        }

        for index in remaining {
            widths[index] = remainingDuration > 0
                ? remainingWidth * CGFloat(positiveDurations[index] / remainingDuration)
                : remainingWidth / CGFloat(remaining.count)
        }

        return widths
    }
}

/// Lock-screen banner. It intentionally mirrors the expanded Dynamic Island:
/// brand + active-time header, compact segmented progress, then one countdown /
/// destination row.
/// The shared body keeps both presentations well inside ActivityKit's height
/// limits and avoids repeating origin, trip number, or route metadata.
private struct LockScreenView: View {
    let model: TripActivityModel
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Label {
                    Text(Brand.name)
                } icon: {
                    TrainIcon(size: 16)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.9))
                Spacer()
                ActiveEventClock(
                    model: model,
                    primaryColor: .white,
                    secondaryColor: .white.opacity(0.72)
                )
            }

            JourneyProgressAndTiming(
                model: model,
                completedColor: .white,
                walkingColor: .white,
                markerFill: .white,
                primaryColor: .white,
                secondaryColor: .white.opacity(0.72)
            )
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        // iOS flips isStale once staleAfterEpochMs passes with no fresher
        // update (phone locked, no push) — dim so the figures read as
        // "last known" rather than live truth.
        .opacity(isStale ? 0.6 : 1)
    }
}

private enum TripActivityPreviewData {
    static let attributes = GenericAttributes(
        id: "preview-trip-143",
        staticValues: [
            "tripNumber": "143",
            "fromStation": "Santa Rosa Downtown",
            "toStation": "Larkspur",
            "routeName": "SMART",
            "direction": "southbound",
        ]
    )

    static var runningState: GenericAttributes.ContentState {
        let now = Date()
        let departure = now.addingTimeInterval(-8 * 60)
        let arrival = now.addingTimeInterval(77 * 60 + 32)
        return GenericAttributes.ContentState(values: [
            "phase": "en-route",
            "departureEpochMs": epochMs(departure),
            "arrivalEpochMs": epochMs(arrival),
            "delayMinutes": "0",
            "nextStop": "Petaluma Downtown",
            "remainingStops": "7",
            "statusText": "On time",
            "isCanceled": "false",
            "isEnded": "false",
            "reminderSet": "true",
            "alarmPending": "false",
        ])
    }

    /// Pre-departure with a leave alarm still ahead: the bell + "Leave in"
    /// countdown stage.
    static var alarmPendingState: GenericAttributes.ContentState {
        let now = Date()
        let reminder = now.addingTimeInterval(12 * 60)
        let departure = now.addingTimeInterval(27 * 60)
        let arrival = now.addingTimeInterval(104 * 60)
        return GenericAttributes.ContentState(values: [
            "phase": "pre-departure",
            "reminderEpochMs": epochMs(reminder),
            "departureEpochMs": epochMs(departure),
            "arrivalEpochMs": epochMs(arrival),
            "delayMinutes": "0",
            "statusText": "On time",
            "isCanceled": "false",
            "isEnded": "false",
            "reminderSet": "true",
            "alarmPending": "true",
        ])
    }

    /// Leave alarm has fired and the rider is part-way through the walk to the
    /// station, so previews exercise the first moving leg of the progress bar.
    static var walkingState: GenericAttributes.ContentState {
        let now = Date()
        let reminder = now.addingTimeInterval(-5 * 60)
        let departure = now.addingTimeInterval(10 * 60)
        let arrival = now.addingTimeInterval(87 * 60)
        return GenericAttributes.ContentState(values: [
            "phase": "pre-departure",
            "reminderEpochMs": epochMs(reminder),
            "departureEpochMs": epochMs(departure),
            "arrivalEpochMs": epochMs(arrival),
            "delayMinutes": "0",
            "statusText": "On time",
            "isCanceled": "false",
            "isEnded": "false",
            "reminderSet": "true",
            "alarmPending": "false",
        ])
    }

    private static func epochMs(_ date: Date) -> String {
        String(Int(date.timeIntervalSince1970 * 1000))
    }
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Lock Screen", as: .content, using: TripActivityPreviewData.attributes) {
    TripActivityWidget()
} contentStates: {
    TripActivityPreviewData.alarmPendingState
    TripActivityPreviewData.walkingState
    TripActivityPreviewData.runningState
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Dynamic Island Compact", as: .dynamicIsland(.compact), using: TripActivityPreviewData.attributes) {
    TripActivityWidget()
} contentStates: {
    TripActivityPreviewData.alarmPendingState
    TripActivityPreviewData.walkingState
    TripActivityPreviewData.runningState
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Dynamic Island Expanded", as: .dynamicIsland(.expanded), using: TripActivityPreviewData.attributes) {
    TripActivityWidget()
} contentStates: {
    TripActivityPreviewData.alarmPendingState
    TripActivityPreviewData.walkingState
    TripActivityPreviewData.runningState
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Dynamic Island Minimal", as: .dynamicIsland(.minimal), using: TripActivityPreviewData.attributes) {
    TripActivityWidget()
} contentStates: {
    TripActivityPreviewData.runningState
}
