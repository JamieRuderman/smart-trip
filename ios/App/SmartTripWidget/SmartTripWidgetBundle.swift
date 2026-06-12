import SwiftUI
import WidgetKit

/**
 * Widget-extension entry point. Hosts only the focused-trip Live Activity —
 * there is no home-screen widget (yet), so the bundle is a single entry.
 */
@main
struct SmartTripWidgetBundle: WidgetBundle {
    var body: some Widget {
        TripActivityWidget()
    }
}
