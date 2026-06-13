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
    enum Phase: String {
        case preDeparture = "pre-departure"
        case enRoute = "en-route"
    }

    // Static attributes
    let tripNumber: String
    let fromStation: String
    let toStation: String
    let routeName: String

    // Dynamic content state
    let phase: Phase
    let departureDate: Date?
    let arrivalDate: Date?
    let delayMinutes: Int
    let nextStop: String?
    let remainingStops: Int?
    let statusText: String
    let isCanceled: Bool
    let isEnded: Bool
    let reminderSet: Bool

    init(context: ActivityViewContext<GenericAttributes>) {
        let attrs = context.attributes.staticValues
        let state = context.state.values

        tripNumber = attrs["tripNumber"] ?? ""
        fromStation = attrs["fromStation"] ?? ""
        toStation = attrs["toStation"] ?? ""
        routeName = attrs["routeName"] ?? "SMART"

        phase = Phase(rawValue: state["phase"] ?? "") ?? .preDeparture
        departureDate = Self.epochMsDate(state["departureEpochMs"])
        arrivalDate = Self.epochMsDate(state["arrivalEpochMs"])
        delayMinutes = Int(state["delayMinutes"] ?? "") ?? 0
        nextStop = Self.nonEmpty(state["nextStop"])
        remainingStops = Int(state["remainingStops"] ?? "")
        statusText = state["statusText"] ?? ""
        isCanceled = state["isCanceled"] == "true"
        isEnded = state["isEnded"] == "true"
        reminderSet = state["reminderSet"] == "true"
    }

    private static func epochMsDate(_ raw: String?) -> Date? {
        guard let raw, let ms = Double(raw), ms.isFinite, ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    private static func nonEmpty(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        return raw
    }
}
