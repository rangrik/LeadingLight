import Tauri
import UserNotifications

private struct ObserverArgs: Decodable { let channel: Channel }
private struct AcknowledgeArgs: Decodable { let channel: String; let id: String }

final class NotificationsPlugin: Plugin {
    private func status(_ invoke: Invoke, requestError: String? = nil) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                let bridge = NotificationBridge.shared
                let authorization: String
                switch settings.authorizationStatus {
                case .authorized: authorization = "authorized"
                case .provisional, .ephemeral: authorization = "provisional"
                case .denied: authorization = "denied"
                case .notDetermined: authorization = "notDetermined"
                @unknown default: authorization = "denied"
                }
                if authorization == "authorized" || authorization == "provisional" { bridge.register() }
                var result: [String: Any] = ["authorization": authorization]
                if let environment = bridge.environment { result["environment"] = environment }
                if authorization == "authorized" || authorization == "provisional", let token = bridge.token { result["token"] = token }
                if let error = requestError ?? bridge.error { result["error"] = error }
                if let error = bridge.configurationError { result["error"] = error }
                invoke.resolve(result)
            }
        }
    }

    @objc func status(_ invoke: Invoke) { status(invoke, requestError: nil) }

    @objc func request(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard NotificationBridge.shared.configurationError == nil else { self.status(invoke); return }
            NotificationBridge.shared.retryRegistration()
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, error in
                self.status(invoke, requestError: error?.localizedDescription)
            }
        }
    }

    @objc func observe(_ invoke: Invoke) throws {
        let observer = try invoke.parseArgs(ObserverArgs.self).channel
        DispatchQueue.main.async {
            NotificationBridge.shared.install()
            NotificationBridge.shared.onChange = { target in
                if let target = target { try? observer.send(target) }
                else { observer.send([:]) }
            }
            if let pending = NotificationBridge.shared.pending() { try? observer.send(pending) }
            invoke.resolve()
        }
    }

    @objc func takePending(_ invoke: Invoke) {
        DispatchQueue.main.async {
            if let pending = NotificationBridge.shared.pending() { invoke.resolve(pending) }
            else { invoke.resolve(Optional<NotificationTarget>.none) }
        }
    }

    @objc func acknowledgePending(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AcknowledgeArgs.self)
        DispatchQueue.main.async {
            NotificationBridge.shared.acknowledge(channel: args.channel, id: args.id)
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_leadinglight_notifications")
public func initPlugin() -> Plugin { NotificationsPlugin() }
