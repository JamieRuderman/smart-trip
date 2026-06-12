import ActivityKit
import SwiftUI
import WidgetKit

/**
 * The focused-trip Live Activity: a self-ticking countdown to departure (then
 * arrival) on the lock screen and in the Dynamic Island. All content arrives
 * via `GenericAttributes` from the app/server (see TripActivityModel for the
 * key contract); `Text(timerInterval:)` ticks natively with no push or
 * app-wake, which is the whole design premise of Phases 1–2.
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
                    VStack(alignment: .leading, spacing: 2) {
                        Label {
                            Text(Brand.name).foregroundStyle(.secondary)
                        } icon: {
                            TrainIcon(size: 13).foregroundStyle(accent)
                        }
                        .font(.caption2.weight(.semibold))
                        Text("Trip \(model.tripNumber)")
                            .font(.title3.weight(.bold))
                    }
                    .padding(.leading, 12)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        StatusPill(model: model)
                        CountdownText(model: model)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(accent)
                            .frame(maxWidth: 84, alignment: .trailing)
                        Text(model.countdownLabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.trailing, 12)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Center + scale + inset so long station names don't clip on
                    // the island's curved corners.
                    HStack(spacing: 6) {
                        Text(model.fromStation)
                        Image(systemName: "arrow.right")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(model.toStation)
                    }
                    .font(.caption)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                TrainIcon(size: 18)
                    .foregroundStyle(accent)
            } compactTrailing: {
                CompactCountdown(model: model)
            } minimal: {
                TrainIcon(size: 18)
                    .foregroundStyle(accent)
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
    /// "Running late" orange — mirrors `--delay` (15 86% 55%) in src/index.css.
    static let orange = Color(red: 0.937, green: 0.357, blue: 0.163)
    /// Cancelled red — mirrors `--destructive` (0 84% 60%) in src/index.css.
    static let red = Color(red: 0.937, green: 0.267, blue: 0.267)
}

/// Status-driven accent: blue when on time, the brand delay orange when late,
/// red when cancelled. Drives the lock-screen background tint and every Dynamic
/// Island accent so the status colour reads the same on both surfaces. Mirrors
/// the precedence in `deriveStatusText` (cancelled > ended > delayed).
private func statusColor(_ model: TripActivityModel) -> Color {
    if model.isCanceled { return Brand.red }
    if model.isEnded { return Brand.blue }
    if model.delayMinutes > 0 { return Brand.orange }
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

/// Status pill. On the black Dynamic Island it carries the status colour
/// itself; on the lock screen the card already supplies that colour, so the
/// pill is a neutral frosted chip (`onColoredBackground`).
private struct StatusPill: View {
    let model: TripActivityModel
    var onColoredBackground = false

    var body: some View {
        Text(model.statusText)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
            .foregroundStyle(.white)
    }

    private var background: Color {
        if onColoredBackground { return .white.opacity(0.22) }
        if model.isCanceled { return Brand.red.opacity(0.9) }
        if model.isEnded { return .white.opacity(0.22) }
        if model.delayMinutes > 0 { return Brand.orange.opacity(0.9) }
        return .white.opacity(0.22)
    }
}

/// The self-ticking countdown, or a static word once there's nothing to count.
private struct CountdownText: View {
    let model: TripActivityModel

    var body: some View {
        if let target = model.countdownTarget {
            Text(timerInterval: Date.now...target, countsDown: true)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        } else {
            Text(model.isCanceled ? "—" : model.isEnded ? "Arrived" : "Due")
        }
    }
}

/// Compact-trailing variant: width-bounded so the island doesn't stretch.
private struct CompactCountdown: View {
    let model: TripActivityModel

    var body: some View {
        if let target = model.countdownTarget {
            Text(timerInterval: Date.now...target, countsDown: true)
                .monospacedDigit()
                .font(.caption2.weight(.semibold))
                .frame(maxWidth: 44)
                .multilineTextAlignment(.trailing)
        } else {
            Image(systemName: model.isCanceled ? "xmark.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(model.isCanceled ? .red : Brand.blue)
        }
    }
}

/// Lock-screen status line. Shows an absolute "departs/arrives at <time>"
/// rather than a ticking countdown: in Always-On Display iOS freezes a live
/// timer's seconds to "--", whereas a fixed clock time always reads correctly.
private struct DepartureLine: View {
    let model: TripActivityModel

    var body: some View {
        if model.isCanceled {
            Text("Trip \(model.tripNumber) canceled")
        } else if model.isEnded {
            Text("Trip \(model.tripNumber) arrived")
        } else if let date = (model.phase == .preDeparture ? model.departureDate : model.arrivalDate) {
            Text("Trip \(model.tripNumber) \(model.phase == .preDeparture ? "departs" : "arrives") at ")
                + Text(date, style: .time).fontWeight(.semibold)
        } else {
            Text(model.tripCountdownLabel)
        }
    }
}

/// Lock-screen banner. White-on-brand-blue to match the app's "My Trip" card.
private struct LockScreenView: View {
    let model: TripActivityModel
    let isStale: Bool
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Label {
                    Text(Brand.name)
                } icon: {
                    TrainIcon(size: 16)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
                Spacer()
                StatusPill(model: model, onColoredBackground: true)
            }

            HStack(spacing: 6) {
                Text(model.fromStation).lineLimit(1)
                Image(systemName: "arrow.right")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
                Text(model.toStation).lineLimit(1)
            }
            .font(.callout.weight(.semibold))
            .foregroundStyle(.white)

            // Active screen ticks the live countdown; Always-On Display (where
            // a live timer freezes its seconds to "--") falls back to the
            // absolute departure time, which always reads correctly.
            if isLuminanceReduced {
                DepartureLine(model: model)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.85))
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(model.tripCountdownLabel)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    CountdownText(model: model)
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(16)
        // iOS flips isStale once staleAfterEpochMs passes with no fresher
        // update (phone locked, no push) — dim so the status reads as
        // "last known" rather than live truth.
        .opacity(isStale ? 0.6 : 1)
    }
}
