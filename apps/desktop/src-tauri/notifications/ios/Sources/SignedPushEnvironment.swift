import Foundation

enum SignedPushEnvironment {
    static func current() -> String? {
        guard let url = Bundle.main.executableURL,
              let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return read(data)
    }

    // Read the entitlement sealed into this executable, not DEBUG or a bundled profile.
    static func read(_ data: Data) -> String? {
        func word(_ offset: Int, big: Bool = false) -> Int? {
            guard offset >= 0, offset <= data.count - 4 else { return nil }
            let bytes = data[offset..<(offset + 4)]
            return (big ? Array(bytes) : Array(bytes.reversed())).reduce(0) { ($0 << 8) | Int($1) }
        }
        guard word(0) == 0xfeedfacf, let count = word(16), count <= 4096,
              let size = word(20), size <= data.count - 32 else { return nil }
        let end = 32 + size
        var cursor = 32
        for _ in 0..<count {
            guard cursor <= end - 8, let command = word(cursor), let length = word(cursor + 4),
                  length >= 8, length <= end - cursor else { return nil }
            defer { cursor += length }
            guard command == 0x1d else { continue }
            guard length >= 16, let start = word(cursor + 8), let available = word(cursor + 12),
                  available >= 12, start <= data.count - available,
                  word(start, big: true) == 0xfade0cc0,
                  let total = word(start + 4, big: true), total >= 12, total <= available,
                  let slots = word(start + 8, big: true), slots <= (total - 12) / 8 else { return nil }
            for slot in 0..<slots {
                let index = start + 12 + slot * 8
                guard word(index, big: true) == 5 else { continue }
                guard let relative = word(index + 4, big: true), relative <= total - 8 else { return nil }
                let blob = start + relative
                guard word(blob, big: true) == 0xfade7171,
                      let bytes = word(blob + 4, big: true), bytes >= 8, bytes <= total - relative,
                      let plist = try? PropertyListSerialization.propertyList(from: data[(blob + 8)..<(blob + bytes)], options: [], format: nil),
                      let values = plist as? [String: Any] else { return nil }
                switch values["aps-environment"] as? String {
                case "development": return "sandbox"
                case "production": return "production"
                default: return nil
                }
            }
        }
        return nil
    }
}
