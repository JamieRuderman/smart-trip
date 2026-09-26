import Foundation

#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI
#endif

/// All AlarmKit access for the local LeaveAlarm plugin. Mirrors the shape of
/// the Live Activity wrapper on the JS side: every entry degrades gracefully
/// (`unavailable` / failure result) on iOS < 26 or when AlarmKit is absent, so
/// the plugin layer never has to special-case OS support.
enum LeaveAlarmKit {
    /// The app's "My Trip" blue — keep in sync with `--my-trip-background`
    /// (211 75% 48%) in src/index.css; AlarmKit presentation can't read CSS.
    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private static var brandTint: Color { Color(red: 0.12, green: 0.47, blue: 0.84) }
    #endif

    static func isAvailable() -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// "authorized" | "denied" | "notDetermined" | "unavailable"
    static func authorizationStatus() -> String {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            switch AlarmManager.shared.authorizationState {
            case .authorized: return "authorized"
            case .denied: return "denied"
            case .notDetermined: return "notDetermined"
            @unknown default: return "denied"
            }
        }
        #endif
        return "unavailable"
    }

    static func requestAuthorization(completion: @escaping (String) -> Void) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let state = try await AlarmManager.shared.requestAuthorization()
                    completion(state == .authorized ? "authorized" : "denied")
                } catch {
                    completion("denied")
                }
            }
            return
        }
        #endif
        completion("unavailable")
    }

    /// Schedule a one-time alarm at an absolute date — unlike a clock-time
    /// alarm, this can target any future calendar day (the whole reason this
    /// plugin exists). The alert shows a stop button and, when
    /// `openButtonTitle` is set, a secondary button that opens the app.
    static func schedule(
        fireAt: Date,
        title: String,
        stopButtonTitle: String,
        openButtonTitle: String?,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    // Generate the id up front so the "View trip" intent can
                    // carry it and stop this exact alarm when tapped.
                    let id = UUID()
                    let stopButton = AlarmButton(
                        text: LocalizedStringResource(String.LocalizationValue(stopButtonTitle)),
                        textColor: .white,
                        systemImageName: LeaveAlarmMetadata.stopSystemImageName
                    )
                    var secondaryButton: AlarmButton?
                    var secondaryBehavior: AlarmPresentation.Alert.SecondaryButtonBehavior?
                    var secondaryIntent: (any LiveActivityIntent)?
                    if let openButtonTitle, !openButtonTitle.isEmpty {
                        // AlarmKit renders this alert out-of-process, so
                        // `systemImageName` resolves built-in SF Symbols only —
                        // the brand train can't load as a custom symbol here (it
                        // renders blank). A system train glyph (e.g. tram.fill)
                        // reads as "almost the brand but wrong", so this button —
                        // which opens the app to the trip — uses a neutral "open"
                        // arrow. The real brand train is on the in-app + widget
                        // surfaces.
                        secondaryButton = AlarmButton(
                            text: LocalizedStringResource(String.LocalizationValue(openButtonTitle)),
                            textColor: .white,
                            systemImageName: "arrow.right"
                        )
                        secondaryBehavior = .custom
                        secondaryIntent = OpenSmartTripIntent(alarmID: id.uuidString)
                    }
                    let alert = AlarmPresentation.Alert(
                        title: LocalizedStringResource(String.LocalizationValue(title)),
                        stopButton: stopButton,
                        secondaryButton: secondaryButton,
                        secondaryButtonBehavior: secondaryBehavior
                    )
                    let attributes = AlarmAttributes<LeaveAlarmMetadata>(
                        presentation: AlarmPresentation(alert: alert),
                        metadata: LeaveAlarmMetadata(stopButtonTitle: stopButtonTitle),
                        tintColor: brandTint
                    )
                    let configuration = AlarmManager.AlarmConfiguration<LeaveAlarmMetadata>.alarm(
                        schedule: .fixed(fireAt),
                        attributes: attributes,
                        secondaryIntent: secondaryIntent
                    )
                    _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
                    completion(.success(id.uuidString))
                } catch {
                    completion(.failure(error))
                }
            }
            return
        }
        #endif
        completion(.failure(LeaveAlarmError.unavailable))
    }

    static func cancel(id: String, completion: @escaping (Result<Void, Error>) -> Void) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard let uuid = UUID(uuidString: id) else {
                completion(.failure(LeaveAlarmError.invalidId))
                return
            }
            do {
                try AlarmManager.shared.cancel(id: uuid)
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
            return
        }
        #endif
        completion(.failure(LeaveAlarmError.unavailable))
    }
}

enum LeaveAlarmError: LocalizedError {
    case unavailable
    case invalidId

    var errorDescription: String? {
        switch self {
        case .unavailable: return "AlarmKit is not available on this device/OS"
        case .invalidId: return "Invalid alarm id"
        }
    }
}
