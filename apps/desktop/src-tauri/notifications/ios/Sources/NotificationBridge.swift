import Foundation
import ObjectiveC
import UIKit
import UserNotifications

final class NotificationBridge: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationBridge()
    private weak var previous: UNUserNotificationCenterDelegate?
    private var hooked = Set<ObjectIdentifier>()
    private var registered = false
    var token: String?
    var error: String?
    var onChange: ((NotificationTarget?) -> Void)?
    lazy var environment = SignedPushEnvironment.current()
    var configurationError: String? {
        if Bundle.main.bundleIdentifier != "com.leadinglight.app" {
            return "Background agent notifications require the signed LeadingLight app. This app identifier is unsupported."
        }
        if environment == nil {
            return "This app was not signed for push notifications. Install a build with the Push Notifications capability."
        }
        return nil
    }

    func install() {
        let center = UNUserNotificationCenter.current()
        if center.delegate !== self {
            previous = center.delegate
            center.delegate = self
        }
    }

    func register() {
        install()
        guard !registered, configurationError == nil else { return }
        guard let delegate = UIApplication.shared.delegate,
              let cls = object_getClass(delegate) else {
            error = "The app's notification delegate is unavailable. Reopen LeadingLight."
            return
        }
        hookRegistration(cls)
        // Refresh UIKit's cached optional selectors without replacing its delegate.
        UIApplication.shared.delegate = delegate
        registered = true
        error = nil
        UIApplication.shared.registerForRemoteNotifications()
    }

    private func hookRegistration(_ cls: AnyClass) {
        guard hooked.insert(ObjectIdentifier(cls)).inserted else { return }
        let success = #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:))
        let oldSuccess = class_getInstanceMethod(cls, success).map(method_getImplementation)
        let successBlock: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { object, app, data in
            if let original = oldSuccess {
                typealias Callback = @convention(c) (AnyObject, Selector, UIApplication, NSData) -> Void
                unsafeBitCast(original, to: Callback.self)(object, success, app, data)
            }
            DispatchQueue.main.async {
                let bridge = NotificationBridge.shared
                bridge.token = (data as Data).map { String(format: "%02x", $0) }.joined()
                bridge.error = nil
                bridge.onChange?(nil)
            }
        }
        class_replaceMethod(cls, success, imp_implementationWithBlock(successBlock), "v@:@@")

        let failure = #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:))
        let oldFailure = class_getInstanceMethod(cls, failure).map(method_getImplementation)
        let failureBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { object, app, error in
            if let original = oldFailure {
                typealias Callback = @convention(c) (AnyObject, Selector, UIApplication, NSError) -> Void
                unsafeBitCast(original, to: Callback.self)(object, failure, app, error)
            }
            DispatchQueue.main.async {
                let bridge = NotificationBridge.shared
                bridge.token = nil
                bridge.error = "Apple could not register notifications: \(error.localizedDescription)"
                bridge.onChange?(nil)
            }
        }
        class_replaceMethod(cls, failure, imp_implementationWithBlock(failureBlock), "v@:@@")
    }

    func retryRegistration() { registered = false }

    private func target(_ content: UNNotificationContent) -> NotificationTarget? {
        NotificationTarget.parse(content.userInfo["ll"])
    }

    func pending() -> NotificationTarget? {
        NotificationTarget.pending(in: .standard)
    }

    func acknowledge(channel: String, id: String) {
        NotificationTarget.acknowledge(channel: channel, id: id, in: .standard)
    }

    private func receive(_ response: UNNotificationResponse) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              response.notification.request.trigger is UNPushNotificationTrigger,
              let target = target(response.notification.request.content) else { return }
        target.save(in: .standard)
        onChange?(target)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completion: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.receive(response)
            if let previous = self.previous,
               previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
                previous.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completion)
            } else { completion() }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
        let own: UNNotificationPresentationOptions = notification.request.trigger is UNPushNotificationTrigger && target(notification.request.content) != nil ? [.banner, .sound] : []
        if let previous = previous,
           previous.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            previous.userNotificationCenter?(center, willPresent: notification) { completion($0.union(own)) }
        } else { completion(own) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
        previous?.userNotificationCenter?(center, openSettingsFor: notification)
    }
}

@_cdecl("leadinglight_notifications_bootstrap")
public func bootstrapNotifications() { NotificationBridge.shared.install() }
