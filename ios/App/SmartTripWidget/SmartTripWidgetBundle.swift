import SwiftUI
import WidgetKit

/**
 * Widget-extension entry point. Hosts the focused-trip Live Activity and the
 * ringing leave alarm's Live Activity — there is no home-screen widget (yet).
 */
@main
struct SmartTripWidgetBundle: WidgetBundle {
    var body: some Widget {
        TripActivityWidget()
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            LeaveAlarmActivityWidget()
        }
        #endif
    }
}
