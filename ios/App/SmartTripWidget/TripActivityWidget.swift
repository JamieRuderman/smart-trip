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
            LockScreenView(model: TripActivityModel(context: context), isStale: context.isStale)
                .activityBackgroundTint(Brand.blue)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let model = TripActivityModel(context: context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label(model.routeName, systemImage: "tram.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("Trip \(model.tripNumber)")
                            .font(.title3.weight(.bold))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        StatusPill(model: model)
                        CountdownText(model: model)
                            .font(.title3.weight(.bold))
                            .frame(maxWidth: 72, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 4) {
                        Text(model.fromStation).lineLimit(1)
                        Image(systemName: "arrow.right")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(model.toStation).lineLimit(1)
                        Spacer()
                        Text(model.countdownLabel)
                            .foregroundStyle(.secondary)
                    }
                    .font(.caption)
                }
            } compactLeading: {
                Image(systemName: "tram.fill")
                    .foregroundStyle(Brand.blue)
            } compactTrailing: {
                CompactCountdown(model: model)
            } minimal: {
                Image(systemName: "tram.fill")
                    .foregroundStyle(Brand.blue)
            }
            .keylineTint(Brand.blue)
        }
    }
}

private enum Brand {
    /// The app's "My Trip" blue — keep in sync with `--my-trip-background`
    /// (211 75% 48%) in src/index.css.
    static let blue = Color(red: 0.12, green: 0.47, blue: 0.84)
    static let gold = Color(red: 0.95, green: 0.72, blue: 0.2)
}

/// Status pill: red when cancelled, gold when delayed, frosted otherwise.
private struct StatusPill: View {
    let model: TripActivityModel

    var body: some View {
        Text(model.statusText)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
            .foregroundStyle(model.isCanceled ? .white : .primary)
    }

    private var background: Color {
        if model.isCanceled { return .red.opacity(0.9) }
        if model.delayMinutes > 0 { return Brand.gold.opacity(0.85) }
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

/// Lock-screen banner. White-on-brand-blue to match the app's "My Trip" card.
private struct LockScreenView: View {
    let model: TripActivityModel
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Label("\(model.routeName) · Trip \(model.tripNumber)", systemImage: "tram.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                Spacer()
                StatusPill(model: model)
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

            HStack(alignment: .firstTextBaseline) {
                Text(model.countdownLabel)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                Spacer()
                CountdownText(model: model)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .padding(16)
        // iOS flips isStale once staleAfterEpochMs passes with no fresher
        // update (phone locked, no push) — dim so the countdown reads as
        // "last known" rather than live truth.
        .opacity(isStale ? 0.6 : 1)
    }
}
