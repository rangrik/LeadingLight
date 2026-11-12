import Foundation
import UIKit

struct PaperAsset: Codable {
    var url: String
    var name: String
    var size: Int
    var mime: String
    func file(in folder: URL) throws -> URL {
        guard !url.isEmpty, !url.hasPrefix("."), !url.contains("/"), !url.contains("\\") else { throw PaperError.message("The attachment address is invalid.") }
        let file = folder.appendingPathComponent(url).resolvingSymlinksInPath()
        guard file.deletingLastPathComponent() == folder.resolvingSymlinksInPath() else { throw PaperError.message("The attachment is outside this page's storage.") }
        return file
    }
}
struct PaperItem: Codable {
    var id: String
    var kind: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var text: String?
    var asset: PaperAsset?
    var fontSize: Double?
}
struct PaperPage: Codable {
    var version: Int
    var style: String?
    var width: Double
    var height: Double
    var updatedAt: Double
    var ink: PaperAsset?
    var preview: PaperAsset?
    var previewHeight: Double?
    var inkBottom: Double?
    var items: [PaperItem]
    func validate() throws {
        guard version == 1, width == 900, height.isFinite, (1400...14000).contains(height), items.count <= 2000,
            items.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.width.isFinite && $0.height.isFinite && $0.width > 0 && $0.height > 0 && $0.width <= 900 && $0.height <= 14000 }) else {
            throw PaperError.message("This paper has an unsupported size or format.")
        }
    }
}
enum PaperError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct PaperAppearance: Decodable {
    let paper: String
    let ink: String
    private func color(_ value: String, fallback: UIColor) -> UIColor {
        guard value.hasPrefix("#"), value.count == 7, let rgb = UInt32(value.dropFirst(), radix: 16) else { return fallback }
        return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    var background: UIColor { color(paper, fallback: .systemBackground) }
    var foreground: UIColor { color(ink, fallback: .label) }
}
