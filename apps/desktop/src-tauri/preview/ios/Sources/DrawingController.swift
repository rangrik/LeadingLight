import PencilKit
import UIKit

final class DrawingController: UIViewController, PKCanvasViewDelegate {
    private let canvas = PKCanvasView()
    private let picker = PKToolPicker()
    private let folder: URL
    private let initial: PKDrawing
    private let finish: ([String: Any]?) -> Void
    private var fitted = false

    init(folder: URL, drawing: PKDrawing, finish: @escaping ([String: Any]?) -> Void) {
        self.folder = folder
        self.initial = drawing
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Handwriting"
        isModalInPresentation = true
        overrideUserInterfaceStyle = .light
        picker.overrideUserInterfaceStyle = .light
        picker.colorUserInterfaceStyle = .light
        view.backgroundColor = .systemBackground
        canvas.backgroundColor = .systemBackground
        canvas.drawingPolicy = .default
        canvas.drawing = initial
        canvas.delegate = self
        // An empty PKDrawing has infinite bounds, which would disable the canvas.
        let bounds = initial.strokes.isEmpty ? CGRect.zero : initial.bounds
        canvas.contentSize = CGSize(width: max(900, bounds.maxX + 80), height: max(1400, bounds.maxY + 600))
        canvas.maximumZoomScale = 3
        canvas.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(canvas)
        NSLayoutConstraint.activate([
            canvas.leadingAnchor.constraint(equalTo: view.leadingAnchor), canvas.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            canvas.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), canvas.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Cancel", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(save))
        toolbarItems = [
            UIBarButtonItem(title: "Undo", style: .plain, target: self, action: #selector(undoStroke)),
            UIBarButtonItem(title: "Redo", style: .plain, target: self, action: #selector(redoStroke))
        ]
        navigationController?.setToolbarHidden(false, animated: false)
        picker.addObserver(canvas)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let fit = min(1, canvas.bounds.width / 900)
        canvas.minimumZoomScale = fit
        if !fitted && fit > 0 { canvas.zoomScale = fit; fitted = true }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        picker.setVisible(true, forFirstResponder: canvas)
        canvas.becomeFirstResponder()
    }
    override func viewWillDisappear(_ animated: Bool) {
        picker.setVisible(false, forFirstResponder: canvas)
        super.viewWillDisappear(animated)
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard !canvas.drawing.strokes.isEmpty else { return }
        canvas.contentSize.height = max(canvas.contentSize.height, canvas.drawing.bounds.maxY * canvas.zoomScale + 600)
    }
    @objc private func undoStroke() { canvas.undoManager?.undo() }
    @objc private func redoStroke() { canvas.undoManager?.redo() }
    @objc private func cancel() { dismiss(animated: true) { self.finish(nil) } }
    @objc private func save() {
        let drawing = canvas.drawing
        guard !drawing.strokes.isEmpty || !initial.strokes.isEmpty else { cancel(); return }
        do {
            let ink = drawing.dataRepresentation()
            let bounds = drawing.strokes.isEmpty ? CGRect(x: 0, y: 0, width: 900, height: 300) : drawing.bounds.insetBy(dx: -24, dy: -24)
            let scale = min(2, 4096 / max(bounds.width, bounds.height))
            let format = UIGraphicsImageRendererFormat()
            format.scale = scale
            format.opaque = true
            let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { context in
                UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                    UIColor.white.setFill()
                    context.fill(CGRect(origin: .zero, size: bounds.size))
                    drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: bounds.size))
                }
            }
            guard let png = image.pngData(), ink.count <= 32 * 1024 * 1024, png.count <= 32 * 1024 * 1024 else {
                throw NSError(domain: "Capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "This drawing is too large. Split it into smaller notes."])
            }
            let id = UUID().uuidString
            let inkFile = folder.appendingPathComponent("\(id).drawing")
            let imageFile = folder.appendingPathComponent("\(id).png")
            try ink.write(to: inkFile, options: .atomic)
            do { try png.write(to: imageFile, options: .atomic) }
            catch { try? FileManager.default.removeItem(at: inkFile); throw error }
            let result: [String: Any] = ["filename": imageFile.lastPathComponent, "size": png.count, "mime": "image/png", "name": "Handwriting.png",
                "drawingFilename": inkFile.lastPathComponent, "drawingSize": ink.count]
            dismiss(animated: true) { self.finish(result) }
        } catch {
            let alert = UIAlertController(title: "Couldn't save handwriting", message: error.localizedDescription, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Keep writing", style: .default))
            present(alert, animated: true)
        }
    }
}
