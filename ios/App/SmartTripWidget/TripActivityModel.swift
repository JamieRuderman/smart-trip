import Foundation
import ActivityKit
import WidgetKit

/**
 * Typed view of the string dictionaries the app sends through
 * `GenericAttributes`. The keys mirror `encodeAttributes` /
 * `encodeContentState` in src/lib/liveActivityContent.ts — that file is the
 * contract; keep them in lockstep. Empty string means "absent" (the TS side
 * maps null → "").
 */
struct TripActivityModel {
    // Static attributes
    let toStation: String
    /// Immutable first-visible instant, carried in static attributes so content
    /// pushes cannot resize the alarm leg of the progress track.
    let timelineStartDate: Date?

    // Dynamic content state
    let departureDate: Date?
    let arrivalDate: Date?
    /// Fire instant of the armed leave alarm, when one is set; the pre-alarm
    /// countdown target.
    let reminderDate: Date?
    let delayMinutes: Int
    let isCanceled: Bool
    let isEnded: Bool
    let reminderSet: Bool

    /// The leave alarm's fire instant while one is armed; nil once cleared.
    var armedReminderDate: Date? { reminderSet ? reminderDate : nil }

    init(context: ActivityViewContext<GenericAttributes>) {
        let attrs = context.attributes.staticValues
        let state = context.state.values

        toStation = attrs["toStation"] ?? ""
        timelineStartDate = Self.epochMsDate(attrs["timelineStartEpochMs"])

        departureDate = Self.epochMsDate(state["departureEpochMs"])
        arrivalDate = Self.epochMsDate(state["arrivalEpochMs"])
        reminderDate = Self.epochMsDate(state["reminderEpochMs"])
        delayMinutes = Int(state["delayMinutes"] ?? "") ?? 0
        isCanceled = state["isCanceled"] == "true"
        isEnded = state["isEnded"] == "true"
        reminderSet = state["reminderSet"] == "true"
    }

    private static func epochMsDate(_ raw: String?) -> Date? {
        guard let raw, let ms = Double(raw), ms.isFinite, ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}
