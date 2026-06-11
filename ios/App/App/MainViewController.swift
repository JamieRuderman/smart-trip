import UIKit
import Capacitor

/**
 * App's bridge view controller — exists to register LOCAL (in-app) Capacitor
 * plugins, which aren't auto-discovered the way packaged pod plugins are.
 * Main.storyboard points its view controller at this class.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LeaveAlarmPlugin())
    }
}
