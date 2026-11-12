import AVFoundation
import PencilKit
import QuickLook
import Tauri
import UIKit
import WebKit

private struct CaptureArgs: Decodable { let folder: String; let kind: String; let path: String? }
private struct RecognitionArgs: Decodable { let path: String; let language: String? }

private struct PreviewArgs: Decodable { let path: String }
private struct PaperArgs: Decodable { let folder: String; let id: String; let title: String; let action: String; let paper: PaperPage; let appearance: PaperAppearance?; let onChange: Channel }
private struct DocumentInkArgs: Decodable { let enabled: Bool; let bounds: InlinePencilBounds?; let onEvent: Channel }

final class PreviewPlugin: Plugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var capturePending: Invoke?
    private var captureFolder: URL?
    private var recognizingSpeech = false
    private var file: NSURL?
    private var pending: Invoke?
    private var inlinePencil: InlinePencil?

    // The web view draws its own top bars; iOS 26's edge effect dimmed the strip under the status bar.
    override func load(webview: WKWebView) {
        if #available(iOS 26.0, *) { webview.scrollView.topEdgeEffect.isHidden = true }
        inlinePencil?.shutdown()
        inlinePencil = InlinePencil(webview: webview) { [weak self] in
            guard let host = self?.manager.viewController else { return false }
            return host.presentedViewController == nil && host.viewIfLoaded?.window != nil
        }
    }

    @objc func documentInk(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(DocumentInkArgs.self)
        DispatchQueue.main.async {
            guard let pencil = self.inlinePencil else { invoke.reject("The page is unavailable."); return }
            guard !args.enabled || args.bounds?.valid == true else { pencil.shutdown(); invoke.reject("The writing area is unavailable."); return }
            pencil.configure(enabled: args.enabled, bounds: args.bounds, channel: args.onEvent)
            invoke.resolve()
        }
    }

    @objc func preview(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PreviewArgs.self)
        DispatchQueue.main.async {
            guard self.pending == nil, let host = self.manager.viewController,
                  host.presentedViewController == nil, host.viewIfLoaded?.window != nil else {
                invoke.reject("Close the current preview or sheet and try again.")
                return
            }
            let url = NSURL(fileURLWithPath: args.path)
            guard QLPreviewController.canPreview(url) else {
                invoke.reject("This file format cannot be previewed on iPad.")
                return
            }
            self.file = url
            self.pending = invoke
            let preview = QLPreviewController()
            preview.dataSource = self
            preview.delegate = self
            self.inlinePencil?.suspend()
            host.present(preview, animated: true)
        }
    }

    @objc func capture(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CaptureArgs.self)
        DispatchQueue.main.async {
            guard self.capturePending == nil, let host = self.manager.viewController, host.presentedViewController == nil else {
                invoke.reject("Close the current sheet and try again."); return
            }
            self.capturePending = invoke
            self.captureFolder = URL(fileURLWithPath: args.folder, isDirectory: true)
            if args.kind == "drawing" {
                do {
                    let drawing = try args.path.map { try PKDrawing(data: Data(contentsOf: URL(fileURLWithPath: $0))) } ?? PKDrawing()
                    let controller = DrawingController(folder: self.captureFolder!, drawing: drawing) { result in
                        self.finishCapture(result)
                    }
                    let navigation = UINavigationController(rootViewController: controller)
                    navigation.overrideUserInterfaceStyle = .light
                    navigation.modalPresentationStyle = .fullScreen
                navigation.modalTransitionStyle = .crossDissolve
                    self.inlinePencil?.suspend()
                    host.present(navigation, animated: true)
                } catch { self.failCapture("Couldn't open the saved handwriting: \(error.localizedDescription)") }
            } else {
                guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                    self.failCapture("No camera is available on this device."); return
                }
                AVCaptureDevice.requestAccess(for: .video) { allowed in
                    DispatchQueue.main.async {
                        guard allowed else { self.failCapture("Camera access is off. Allow LeadingLight in Settings → Privacy & Security → Camera."); return }
                        guard host.presentedViewController == nil, host.viewIfLoaded?.window != nil else {
                            self.failCapture("Return to the page and try the camera again."); return
                        }
                        let camera = UIImagePickerController()
                        camera.sourceType = .camera
                        camera.cameraDevice = .rear
                        camera.delegate = self
                        camera.modalPresentationStyle = .fullScreen
                        self.inlinePencil?.suspend()
                        host.present(camera, animated: true)
                    }
                }
            }
        }
    }

    @objc func editPaper(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PaperArgs.self)
        DispatchQueue.main.async {
            guard let host = self.manager.viewController, host.presentedViewController == nil else {
                invoke.reject("Close the current sheet and try again."); return
            }
            do {
                let controller = try PaperController(folder: URL(fileURLWithPath: args.folder), id: args.id, title: args.title, paper: args.paper, action: args.action, appearance: args.appearance, changed: { paper in
                    try? args.onChange.send(paper)
                }, finish: { paper in
                    do {
                        let data = try JSONEncoder().encode(paper)
                        invoke.resolve(try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:])
                    } catch { invoke.reject(error.localizedDescription) }
                })
                let navigation = UINavigationController(rootViewController: controller)
                navigation.overrideUserInterfaceStyle = .light
                navigation.modalPresentationStyle = .fullScreen
                navigation.modalTransitionStyle = .crossDissolve
                host.view.endEditing(true)
                self.inlinePencil?.suspend()
                host.present(navigation, animated: true)
            } catch { invoke.reject("Couldn't open the paper: \(error.localizedDescription)") }
        }
    }

    private func finishCapture(_ result: [String: Any]?) {
        capturePending?.resolve(result ?? ["cancelled": true])
        capturePending = nil
        captureFolder = nil
    }
    private func failCapture(_ message: String) {
        capturePending?.reject(message)
        capturePending = nil
        captureFolder = nil
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { self.finishCapture(nil) }
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        do {
            guard let original = info[.originalImage] as? UIImage, let folder = captureFolder else { throw NSError(domain: "Capture", code: 2) }
            let scale = min(1, 3200 / max(original.size.width, original.size.height))
            let size = CGSize(width: original.size.width * scale, height: original.size.height * scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in original.draw(in: CGRect(origin: .zero, size: size)) }
            guard let bytes = image.jpegData(compressionQuality: 0.9) else { throw NSError(domain: "Capture", code: 3) }
            let filename = "\(UUID().uuidString).jpg"
            try bytes.write(to: folder.appendingPathComponent(filename), options: .atomic)
            picker.dismiss(animated: true) { self.finishCapture(["filename": filename, "name": "Photo.jpg", "mime": "image/jpeg", "size": bytes.count]) }
        } catch {
            picker.dismiss(animated: true) { self.failCapture("Couldn't save the photo: \(error.localizedDescription). Please take it again.") }
        }
    }

    @objc func recognizeText(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RecognitionArgs.self)
        DispatchQueue.global(qos: .userInitiated).async {
            do { invoke.resolve(["text": try recognizeImage(path: args.path)]) }
            catch { invoke.reject("Text recognition failed: \(error.localizedDescription). The image is saved.") }
        }
    }
    @objc func transcribe(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RecognitionArgs.self)
        DispatchQueue.main.async {
            guard !self.recognizingSpeech else { invoke.reject("Another recording is being transcribed. Retry when it finishes."); return }
            guard #available(iOS 26.0, *) else { invoke.reject("Transcription requires iOS or iPadOS 26 or newer. Your audio is saved."); return }
            self.recognizingSpeech = true
            Task { @MainActor in
                do { invoke.resolve(["text": try await recognizeSpeech(path: args.path, language: args.language ?? Locale.current.identifier)]) }
                catch { invoke.reject("Transcription failed: \(error.localizedDescription). Your audio is saved.") }
                self.recognizingSpeech = false
            }
        }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { file == nil ? 0 : 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { file! }

    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        file = nil
        pending?.resolve()
        pending = nil
    }
}

@_cdecl("init_plugin_leadinglight_preview")
public func initPlugin() -> Plugin { PreviewPlugin() }
