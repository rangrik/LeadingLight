import Foundation

@main struct BoundaryTests {
    static func main() throws {
        // A signed entitlement chooses the APNs endpoint; malformed signatures cannot guess one.
        func executable(_ environment: String) throws -> Data {
            let plist = try PropertyListSerialization.data(fromPropertyList: ["aps-environment": environment], format: .xml, options: 0)
            func words(_ values: [UInt32], big: Bool = false) -> Data {
                values.reduce(into: Data()) { data, word in
                    var value = big ? word.bigEndian : word.littleEndian
                    withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
                }
            }
            let blob = words([0xfade7171, UInt32(plist.count + 8)], big: true) + plist
            let signature = words([0xfade0cc0, UInt32(blob.count + 20), 1, 5, 20], big: true) + blob
            return words([0xfeedfacf, 0, 0, 0, 1, 16, 0, 0, 0x1d, 16, 48, UInt32(signature.count)]) + signature
        }
        let sandbox = try executable("development")
        let production = try executable("production")
        let unknown = try executable("debug")
        assert(SignedPushEnvironment.read(sandbox) == "sandbox")
        assert(SignedPushEnvironment.read(production) == "production")
        assert(SignedPushEnvironment.read(unknown) == nil)
        for count in 0..<sandbox.count { assert(SignedPushEnvironment.read(Data(sandbox.prefix(count))) == nil) }

        // Push data crosses an untrusted boundary; only bounded encrypted targets reach app routing.
        let id = "b69a5d6e-8292-4e9c-a20e-43f82340fe41"
        let envelope: [String: Any] = ["v": 2, "iv": Data(repeating: 0, count: 12).base64EncodedString(), "data": Data(repeating: 0, count: 16).base64EncodedString()]
        let target: [String: Any] = ["channel": id, "id": id, "envelope": envelope]
        assert(NotificationTarget.parse(target)?.id == id)
        var invalid = target
        invalid["channel"] = "https://another.example"
        assert(NotificationTarget.parse(invalid) == nil)
        invalid = target
        invalid["id"] = "../other"
        assert(NotificationTarget.parse(invalid) == nil)
        invalid = target
        invalid["envelope"] = ["v": 2, "iv": "", "data": String(repeating: "A", count: 5000)]
        assert(NotificationTarget.parse(invalid) == nil)
        assert(NotificationTarget.parse(["channel": id]) == nil)
        assert(NotificationTarget.parse(nil) == nil)

        // Peeking retains a cold tap; a late acknowledgment cannot erase a newer tap.
        let suite = "LeadingLight-notification-test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        NotificationTarget.parse(target)!.save(in: defaults)
        assert(NotificationTarget.pending(in: defaults)?.id == id)
        assert(NotificationTarget.pending(in: defaults)?.id == id)
        let newerID = UUID().uuidString.lowercased()
        var newer = target
        newer["id"] = newerID
        NotificationTarget.parse(newer)!.save(in: defaults)
        NotificationTarget.acknowledge(channel: id, id: id, in: defaults)
        assert(NotificationTarget.pending(in: defaults)?.id == newerID)
        NotificationTarget.acknowledge(channel: newerID, id: newerID, in: defaults)
        assert(NotificationTarget.pending(in: defaults)?.id == newerID)
        NotificationTarget.acknowledge(channel: id, id: newerID, in: defaults)
        assert(NotificationTarget.pending(in: defaults) == nil)
        print("Notification entitlement and encrypted-target boundaries passed")
    }
}
