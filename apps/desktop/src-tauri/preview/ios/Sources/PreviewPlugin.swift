import QuickLook
import Tauri
import UIKit

private struct PreviewArgs: Decodable { let path: String }

final class PreviewPlugin: Plugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private var file: NSURL?
    private var pending: Invoke?

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
            host.present(preview, animated: true)
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
