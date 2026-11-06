import Foundation

struct NotificationTarget: Codable {
    struct Envelope: Codable { let v: Int; let iv: String; let data: String }
    let channel: String
    let id: String
    let envelope: Envelope
    private static let pendingKey = "LeadingLight.mobileNotification.target"

    func save(in defaults: UserDefaults) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.pendingKey)
    }

    static func pending(in defaults: UserDefaults) -> Self? {
        defaults.data(forKey: pendingKey).flatMap { try? JSONSerialization.jsonObject(with: $0) }.flatMap(parse)
    }

    static func acknowledge(channel: String, id: String, in defaults: UserDefaults) {
        guard let current = pending(in: defaults), current.channel == channel, current.id == id else { return }
        defaults.removeObject(forKey: pendingKey)
    }

    static func parse(_ value: Any?) -> NotificationTarget? {
        guard let value = value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 4096,
              let target = try? JSONDecoder().decode(Self.self, from: data),
              target.channel.count == 36, UUID(uuidString: target.channel) != nil,
              target.id.count == 36, UUID(uuidString: target.id) != nil,
              target.envelope.v == 2, Data(base64Encoded: target.envelope.iv)?.count == 12,
              let ciphertext = Data(base64Encoded: target.envelope.data), ciphertext.count >= 16 else { return nil }
        return target
    }
}

