// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-leadinglight-notifications",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-leadinglight-notifications", type: .static, targets: ["Notifications"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "Notifications", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
