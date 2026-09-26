#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 26.0, *)
private typealias LeaveAlarmContext = ActivityViewContext<AlarmAttributes<LeaveAlarmMetadata>>

/**
 * The ringing leave alarm's Live Activity. AlarmKit starts it when the alarm
 * fires and SpringBoard asks this extension to render it, so without this
 * configuration the island is an empty pill with no way to stop the alarm.
 * Button wiring follows Apple's "Scheduling an alarm with AlarmKit" sample:
 * each button runs a `LiveActivityIntent` carrying the alarm's id.
 */
@available(iOS 26.0, *)
struct LeaveAlarmActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<LeaveAlarmMetadata>.self) { context in
            LeaveAlarmLockScreenView(context: context)
                .activityBackgroundTint(context.attributes.tintColor)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let tint = context.attributes.tintColor
            let bell = BellRingIcon(size: 20).foregroundStyle(tint)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    BellRingIcon(size: 24)
                        .foregroundStyle(tint)
                        .padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    AlarmTime(state: context.state)
                        .font(.caption.weight(.semibold))
                        .padding(.trailing, 8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 10) {
                        AlarmTitle(attributes: context.attributes)
                        LeaveAlarmControls(context: context, onLockScreen: false)
                    }
                    .padding(.horizontal, 8)
                }
            } compactLeading: {
                bell.padding(.horizontal, 2)
            } compactTrailing: {
                AlarmTime(state: context.state)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
            } minimal: {
                bell
            }
            .keylineTint(tint)
        }
    }
}

@available(iOS 26.0, *)
private struct LeaveAlarmLockScreenView: View {
    let context: LeaveAlarmContext

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                BellRingIcon(size: 22)
                AlarmTitle(attributes: context.attributes)
                Spacer(minLength: 0)
                AlarmTime(state: context.state)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }
            LeaveAlarmControls(context: context, onLockScreen: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
}

@available(iOS 26.0, *)
private struct AlarmTitle: View {
    let attributes: AlarmAttributes<LeaveAlarmMetadata>

    var body: some View {
        Text(attributes.presentation.alert.title)
            .font(.headline)
            .lineLimit(2)
    }
}

/// The time the alarm went off. Empty outside the alert mode, which a
/// fixed-date alarm never leaves.
@available(iOS 26.0, *)
private struct AlarmTime: View {
    let state: AlarmPresentationState

    var body: some View {
        if case .alert(let alert) = state.mode,
           let date = Calendar.current.date(
               bySettingHour: alert.time.hour, minute: alert.time.minute, second: 0, of: .now
           ) {
            Text(date, style: .time)
                .lineLimit(1)
        }
    }
}

@available(iOS 26.0, *)
private struct LeaveAlarmControls: View {
    let context: LeaveAlarmContext
    let onLockScreen: Bool

    var body: some View {
        let attributes = context.attributes
        let alarmID = context.state.alarmID.uuidString
        let tint = attributes.tintColor
        HStack(spacing: 8) {
            if let viewTrip = attributes.presentation.alert.secondaryButton {
                Button(intent: OpenSmartTripIntent(alarmID: alarmID)) {
                    Label(viewTrip.text, systemImage: viewTrip.systemImageName)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.white)
            }
            Button(intent: StopLeaveAlarmIntent(alarmID: alarmID)) {
                Label(
                    attributes.metadata?.stopButtonTitle ?? "Stop",
                    systemImage: LeaveAlarmMetadata.stopSystemImageName
                )
                .foregroundStyle(onLockScreen ? tint : .white)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(onLockScreen ? .white : tint)
        }
        .font(.subheadline.weight(.semibold))
        .lineLimit(1)
    }
}

@available(iOS 26.1, *)
private enum LeaveAlarmPreviewData {
    static let attributes = AlarmAttributes<LeaveAlarmMetadata>(
        presentation: AlarmPresentation(
            alert: AlarmPresentation.Alert(
                title: "Leave for Santa Rosa Downtown",
                secondaryButton: AlarmButton(text: "View trip", textColor: .white, systemImageName: "arrow.right"),
                secondaryButtonBehavior: .custom
            )
        ),
        metadata: LeaveAlarmMetadata(stopButtonTitle: "Stop"),
        tintColor: Brand.blue
    )

    static let ringing = AlarmPresentationState(
        alarmID: UUID(),
        mode: .alert(.init(time: .init(hour: 7, minute: 42)))
    )
}

@available(iOSApplicationExtension 26.1, *)
#Preview("Leave Alarm Lock Screen", as: .content, using: LeaveAlarmPreviewData.attributes) {
    LeaveAlarmActivityWidget()
} contentStates: {
    LeaveAlarmPreviewData.ringing
}

@available(iOSApplicationExtension 26.1, *)
#Preview("Leave Alarm Expanded", as: .dynamicIsland(.expanded), using: LeaveAlarmPreviewData.attributes) {
    LeaveAlarmActivityWidget()
} contentStates: {
    LeaveAlarmPreviewData.ringing
}

@available(iOSApplicationExtension 26.1, *)
#Preview("Leave Alarm Compact", as: .dynamicIsland(.compact), using: LeaveAlarmPreviewData.attributes) {
    LeaveAlarmActivityWidget()
} contentStates: {
    LeaveAlarmPreviewData.ringing
}
#endif
