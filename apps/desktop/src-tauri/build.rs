fn main() {
    println!("cargo:rerun-if-changed=swift/Transcribe.swift");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=Entitlements.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let target = std::env::var("TARGET").unwrap();
        let architecture = if target.starts_with("aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        std::fs::create_dir_all("binaries").unwrap();
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-parse-as-library",
                "-O",
                "-target",
                &format!("{architecture}-apple-macosx11.0"),
                "swift/Transcribe.swift",
                "-o",
                &format!("binaries/leadinglight-transcribe-{target}"),
            ])
            .status()
            .expect("The voice transcription helper needs the Xcode command line tools to build");
        assert!(
            status.success(),
            "Could not build the voice transcription helper"
        );
    }
    tauri_build::build()
}
