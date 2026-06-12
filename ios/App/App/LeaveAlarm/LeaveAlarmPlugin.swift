import Foundation
import Capacitor

/**
 * Local (in-app) Capacitor plugin for the "Leave Alarm" feature — replaces
 * `@capgo/capacitor-alarm`, whose JS API only took an hour/minute and so could
 * only target the NEXT occurrence of a clock time. This plugin schedules
 * AlarmKit alarms at an absolute date (any future day) and adds the custom
 * alert presentation (branded tint, stop button, secondary "View trip" button
 * that opens the app) that the published plugin doesn't expose.
 *
 * Registered from MainViewController.capacitorDidLoad(); the JS side binds via
 * `registerPlugin("LeaveAlarm")` in src/lib/native/leaveAlarm.ts. iOS-only by
 * design (AlarmKit, iOS 26+) — Android/web stay on the notification path and
 * never call into this.
 */
@objc(LeaveAlarmPlugin)
public class LeaveAlarmPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LeaveAlarmPlugin"
    public let jsName = "LeaveAlarm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["value": LeaveAlarmKit.isAvailable()])
    }

    @objc func checkAuthorization(_ call: CAPPluginCall) {
        call.resolve(["status": LeaveAlarmKit.authorizationStatus()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        LeaveAlarmKit.requestAuthorization { status in
            call.resolve(["status": status])
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        // Epoch ms arrives as a JS number — read as Double (it exceeds Int32).
        guard let fireAtMs = call.getDouble("fireAtMs"), fireAtMs.isFinite else {
            call.reject("fireAtMs is required")
            return
        }
        guard let title = call.getString("title"), !title.isEmpty else {
            call.reject("title is required")
            return
        }
        let fireAt = Date(timeIntervalSince1970: fireAtMs / 1000)
        guard fireAt.timeIntervalSinceNow > 0 else {
            call.reject("fireAtMs must be in the future")
            return
        }
        LeaveAlarmKit.schedule(
            fireAt: fireAt,
            title: title,
            stopButtonTitle: call.getString("stopButtonTitle") ?? "Stop",
            openButtonTitle: call.getString("openButtonTitle")
        ) { result in
            switch result {
            case .success(let id):
                call.resolve(["id": id])
            case .failure(let error):
                call.reject("Failed to schedule alarm: \(error.localizedDescription)")
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("id is required")
            return
        }
        LeaveAlarmKit.cancel(id: id) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject("Failed to cancel alarm: \(error.localizedDescription)")
            }
        }
    }
}
