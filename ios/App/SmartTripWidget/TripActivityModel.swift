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
    }

    /// The countdown the headline shows: departure until the train leaves,
    /// then arrival. Nil when there's nothing left to count down to.
    var countdownTarget: Date? {
        guard !isEnded, !isCanceled else { return nil }
        let target = phase == .preDeparture ? departureDate : arrivalDate
        // A target at/behind "now" renders as a frozen 0:00 — let the view
        // fall back to a static label instead.
        guard let target, target.timeIntervalSinceNow > 0 else { return nil }
        return target
    }

    /// Short label above/next to the countdown.
    var countdownLabel: String {
        if isCanceled { return "Cancelled" }
        if isEnded { return "Arrived" }
        return phase == .preDeparture ? "Departs in" : "Arrives in"
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
