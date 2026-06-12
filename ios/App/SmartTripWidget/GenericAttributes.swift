import ActivityKit

/**
 * EXACT copy of capacitor-live-activity's `GenericAttributes`
 * (node_modules/capacitor-live-activity/ios/Sources/LiveActivityPlugin/Shared/
 * GenericAttributes.swift). ActivityKit matches a running activity to a
 * widget's `ActivityConfiguration` by the attributes TYPE NAME, and decodes
 * both the local and the APNs-pushed content state with this `ContentState`'s
 * Codable shape — so the name and the stored properties here must not drift
 * from the plugin's. (This is the plugin's documented widget integration; the
 * widget target can't link the pod itself.)
 */
public struct GenericAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var values: [String: String]
        public init(values: [String: String]) { self.values = values }
    }

    public var id: String
    public var staticValues: [String: String]

    public init(id: String, staticValues: [String: String]) {
        self.id = id
        self.staticValues = staticValues
    }
}
