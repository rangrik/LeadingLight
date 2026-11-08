import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

precondition(CommandLine.arguments.count == 3, "Usage: swift scripts/ios-icons.swift INPUT_DIR OUTPUT_DIR")
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
for file in try FileManager.default.contentsOfDirectory(at: input, includingPropertiesForKeys: nil) where file.pathExtension == "png" {
  let source = CGImageSourceCreateWithURL(file as CFURL, nil)!
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
  // iOS icons need opaque RGB; the generator's solid background is already composited.
  let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  let target = CGImageDestinationCreateWithURL(output.appendingPathComponent(file.lastPathComponent) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(target, context.makeImage()!, nil)
  guard CGImageDestinationFinalize(target) else { fatalError("PNG encoding failed") }
}
