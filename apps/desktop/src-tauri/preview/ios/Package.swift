// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-leadinglight-preview",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-leadinglight-preview", type: .static, targets: ["Preview"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "Preview", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
