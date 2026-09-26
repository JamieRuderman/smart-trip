#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import Foundation

// Compiled into both the App and SmartTripWidget targets: the widget matches the
// alarm's Live Activity and its button intents by these type names.

@available(iOS 26.0, *)
struct LeaveAlarmMetadata: AlarmMetadata {
    static let stopSystemImageName = "stop.fill"

    /// The localized Stop label. AlarmKit no longer exposes the alert's stop
    /// button (deprecated in iOS 26.1), so the widget reads it from here.
    var stopButtonTitle: String?
}

/// Runs when the alarm's secondary ("View trip") button is tapped: stops the
/// ringing alarm, then foregrounds the app, which lands on the focused-trip
/// card. Not user-discoverable — it exists only as the alarm button's action.
///
/// Stopping is our responsibility here: AlarmKit's `.custom` secondary behavior
/// runs this intent but, unlike the stop button, does NOT silence the alarm. If
/// we only opened the app the alert would be dismissed while the alarm kept
/// ringing — and with its UI gone the user would have no way to stop it. So we
/// stop the alarm by id (baked in at schedule time) before returning, matching
/// Android's "View trip" which also dismisses the alarm.
@available(iOS 26.0, *)
struct OpenSmartTripIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Open SMART Trip"
    static let description = IntentDescription("Opens SMART Trip to your focused trip.")
    static let isDiscoverable: Bool = false
    static let openAppWhenRun: Bool = true

    /// The alarm to silence — set when the alarm is scheduled so the button
    /// knows which alert it belongs to.
    @Parameter(title: "Alarm ID")
    var alarmID: String

    init() {}

    init(alarmID: String) {
        self.alarmID = alarmID
    }

    func perform() async throws -> some IntentResult {
        if let uuid = UUID(uuidString: alarmID) {
            try? AlarmManager.shared.stop(id: uuid)
        }
        return .result()
    }
}

@available(iOS 26.0, *)
struct StopLeaveAlarmIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop Leave Alarm"
    static let description = IntentDescription("Stops the ringing leave alarm.")
    static let isDiscoverable: Bool = false

    @Parameter(title: "Alarm ID")
    var alarmID: String

    init() {}

    init(alarmID: String) {
        self.alarmID = alarmID
    }

    func perform() async throws -> some IntentResult {
        if let uuid = UUID(uuidString: alarmID) {
            try? AlarmManager.shared.stop(id: uuid)
        }
        return .result()
    }
}
#endif
