import AVFoundation
import PencilKit
import QuickLook
import UIKit

private final class PaperOverlay: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if event?.allTouches?.contains(where: { $0.type == .pencil }) == true { return nil }
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

private final class PaperSheet: UIView {
    weak var canvas: PKCanvasView?
    var beginInk: (() -> Void)?
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if bounds.contains(point), event?.allTouches?.contains(where: { $0.type == .pencil }) == true, let canvas = canvas {
            beginInk?()
            return canvas.hitTest(convert(point, to: canvas), with: event)
        }
        return super.hitTest(point, with: event)
    }
}

private final class PaperDrag: UIPanGestureRecognizer {
    var startPoint: CGPoint?
    weak var coordinateSpace: UIView?
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        startPoint = touches.first?.location(in: coordinateSpace)
        super.touchesBegan(touches, with: event)
    }
}

final class PaperController: UIViewController, PKCanvasViewDelegate, UIScrollViewDelegate, UITextViewDelegate, UIGestureRecognizerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, UIEditMenuInteractionDelegate, AVAudioPlayerDelegate, PKToolPickerObserver, UIPencilInteractionDelegate, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private let scroll = UIScrollView()
    private let sheet = PaperSheet()
    private let page = UIView()
    private let ruling = CAShapeLayer()
    private let margin = CAShapeLayer()
    private let heading = UILabel()
    private let subtitle = UILabel()
    private let toolbar = UIToolbar()
    private var toolButtons: [String: UIButton] = [:]
    private var activeTool = "pen"
    private var previousTool: PKTool = PKEraserTool(.vector)
    private var previousToolName = "eraser"
    private var typing = false
    private var systemPalette = false
    private var penWidth: CGFloat = 2.5
    private var inkColor = UIColor.label
    private var paperColor = UIColor.systemBackground
    private var paperInk = UIColor.label
    private let canvas = PKCanvasView()
    private let picker = PKToolPicker()
    private let paperUndo = UndoManager()
    override var undoManager: UndoManager? { paperUndo }
    private let selectionOverlay = PaperOverlay()
    private let selectionBorder = UIView()
    private let resizeKnob = UIButton(type: .custom)
    private lazy var editMenu = UIEditMenuInteraction(delegate: self)
    private var editingItem: String?
    private let folder: URL
    private let draft: URL
    private var paper: PaperPage
    private let changed: (PaperPage) -> Void
    private let finish: (PaperPage) -> Void
    private var action: String
    private var itemViews: [String: UIView] = [:]
    private var selected: String?
    private var movingItem: String?
    private var dragStart: (point: CGPoint, frame: CGRect)?
    private var fitted = false
    private var inkDirty = false
    private var dirty = false
    private var saveWork: DispatchWorkItem?
    private var recorder: AVAudioRecorder?
    private var recordTimer: Timer?
    private var player: AVAudioPlayer?
    private var playingId: String?
    private var previewFile: NSURL?
    private var durations: [String: TimeInterval] = [:]
    private var captureStates: [String: String] = [:]
    private var pendingTranscriptions: [PaperItem] = []
    private var requestingMic = false
    private var transcribing = false
    private var closed = false
    private var transcriptionTask: Task<Void, Never>?
    private var recognizingPhoto = false
    private lazy var recordButton = UIBarButtonItem(image: UIImage(systemName: "mic"), style: .plain, target: self, action: #selector(record))
    private lazy var moreButton = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: UIMenu())
    private lazy var cameraButton = UIBarButtonItem(barButtonSystemItem: .camera, target: self, action: #selector(photo))

    init(folder: URL, id: String, title: String, paper: PaperPage, action: String, appearance: PaperAppearance?, changed: @escaping (PaperPage) -> Void, finish: @escaping (PaperPage) -> Void) throws {
        self.folder = folder
        let drafts = folder.deletingLastPathComponent().appendingPathComponent("paper-drafts", isDirectory: true)
        try FileManager.default.createDirectory(at: drafts, withIntermediateDirectories: true)
        draft = drafts.appendingPathComponent("\(id).json")
        var recovered = paper
        if let data = try? Data(contentsOf: draft), let saved = try? JSONDecoder().decode(PaperPage.self, from: data), saved.updatedAt > paper.updatedAt { recovered = saved }
        try recovered.validate()
        if recovered.previewHeight == nil { recovered.previewHeight = recovered.height }
        self.paper = recovered
        self.action = action
        self.changed = changed
        self.finish = finish
        self.paperColor = appearance?.background ?? .systemBackground
        self.paperInk = appearance?.foreground ?? .label
        self.inkColor = appearance?.foreground ?? .label
        super.init(nibName: nil, bundle: nil)
        self.title = title.isEmpty ? "Untitled paper" : title
        if let ink = recovered.ink {
            do { canvas.drawing = try PKDrawing(data: Data(contentsOf: ink.file(in: folder))) }
            catch { throw PaperError.message("The ink file is unavailable or unreadable. Let this page finish syncing, then try Handwrite again. Your saved paper is unchanged.") }
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { recordTimer?.invalidate(); NotificationCenter.default.removeObserver(self) }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .light
        isModalInPresentation = true
        view.backgroundColor = paperColor
        view.tintColor = paperInk
        page.backgroundColor = paperColor
        sheet.backgroundColor = .clear
        navigationController?.setNavigationBarHidden(true, animated: false)
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)
        let appearance = UIToolbarAppearance()
        appearance.configureWithTransparentBackground()
        toolbar.standardAppearance = appearance; toolbar.scrollEdgeAppearance = appearance
        toolbar.tintColor = paperInk
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.delegate = self
        scroll.maximumZoomScale = 3
        scroll.keyboardDismissMode = .interactive
        scroll.alwaysBounceVertical = true
        view.addSubview(scroll)
        selectionOverlay.translatesAutoresizingMaskIntoConstraints = false
        selectionOverlay.clipsToBounds = true
        view.addSubview(selectionOverlay)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), toolbar.heightAnchor.constraint(equalToConstant: 52),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8), toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: toolbar.bottomAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            selectionOverlay.leadingAnchor.constraint(equalTo: scroll.leadingAnchor), selectionOverlay.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            selectionOverlay.topAnchor.constraint(equalTo: scroll.topAnchor), selectionOverlay.bottomAnchor.constraint(equalTo: scroll.bottomAnchor)
        ])
        selectionBorder.isUserInteractionEnabled = false
        selectionBorder.layer.borderWidth = 1.5
        selectionBorder.layer.cornerRadius = 6
        selectionBorder.layer.borderColor = view.tintColor.cgColor
        selectionOverlay.addSubview(selectionBorder)
        resizeKnob.accessibilityLabel = "Resize text or attachment"
        let dot = UIView(frame: CGRect(x: 16, y: 16, width: 12, height: 12))
        dot.isUserInteractionEnabled = false; dot.layer.cornerRadius = 6
        dot.backgroundColor = paperColor; dot.layer.borderWidth = 1.5; dot.layer.borderColor = view.tintColor.cgColor
        resizeKnob.addSubview(dot)
        let resize = PaperDrag(target: self, action: #selector(resizeItem(_:)))
        resize.coordinateSpace = sheet; resizeKnob.addGestureRecognizer(resize)
        selectionOverlay.addSubview(resizeKnob)
        sheet.addInteraction(editMenu)
        scroll.addSubview(page)
        page.layer.addSublayer(ruling); page.layer.addSublayer(margin)
        heading.text = title; heading.textColor = paperInk; heading.font = .systemFont(ofSize: 30, weight: .semibold)
        subtitle.text = "Notebook"; subtitle.textColor = paperInk.withAlphaComponent(0.65); subtitle.font = .systemFont(ofSize: 15)
        page.addSubview(heading); page.addSubview(subtitle); page.addSubview(sheet)
        sheet.addSubview(canvas)
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.isScrollEnabled = false
        canvas.drawingPolicy = UIDevice.current.userInterfaceIdiom == .pad ? .pencilOnly : .anyInput
        sheet.canvas = canvas
        sheet.beginInk = { [weak self] in if self?.typing == true { self?.chooseTool("pen") } }
        canvas.delegate = self
        let pencil = UIPencilInteraction(); pencil.delegate = self
        view.addInteraction(pencil)
        picker.overrideUserInterfaceStyle = .light
        picker.colorUserInterfaceStyle = .light
        picker.addObserver(canvas)
        picker.addObserver(self)
        canvas.tool = PKInkingTool(.pen, color: inkColor, width: penWidth)
        buildToolbar()
        recordButton.accessibilityLabel = "Record"
        cameraButton.accessibilityLabel = "Photo"
        let tap = UITapGestureRecognizer(target: self, action: #selector(placeText(_:)))
        tap.delegate = self
        tap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        sheet.addGestureRecognizer(tap)
        layoutPaper()
        renderItems()
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }
    private func buildToolbar() {
        var items = [tool("back", image: "chevron.left", label: "Back to page") { [weak self] in self?.done() }]
        let tools = UIDevice.current.userInterfaceIdiom == .phone ? ["pen", "text"] : ["pen", "marker", "eraser", "lasso", "text", "undo", "redo"]
        let symbols = ["pen": "pencil.tip", "marker": "highlighter", "eraser": "eraser", "lasso": "lasso", "text": "textformat", "undo": "arrow.uturn.backward", "redo": "arrow.uturn.forward"]
        let labels = ["pen": "Pen", "marker": "Highlighter", "eraser": "Eraser", "lasso": "Select ink", "text": "Text", "undo": "Undo", "redo": "Redo"]
        for name in tools { items.append(tool(name, image: symbols[name]!, label: labels[name]!) { [weak self] in self?.chooseTool(name) }) }
        items.append(UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil))
        items += [recordButton, cameraButton, moreButton]
        for item in items { if #available(iOS 26.0, *) { item.hidesSharedBackground = true } }
        toolbar.items = items
        updateMenu(); refreshTools()
    }
    private func tool(_ name: String, image: String, label: String, action: @escaping () -> Void) -> UIBarButtonItem {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: image, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .regular)), for: .normal)
        button.accessibilityLabel = label; button.tintColor = paperInk
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true; button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let mark = UIView(frame: CGRect(x: 13, y: 40, width: 18, height: 2)); mark.tag = 33
        mark.backgroundColor = paperInk; mark.isUserInteractionEnabled = false; button.addSubview(mark)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        toolButtons[name] = button
        return UIBarButtonItem(customView: button)
    }
    private func chooseTool(_ name: String) {
        if name == "undo" { undoEdit(); return }
        if name == "redo" { redoEdit(); return }
        if name == "text", editingItem != nil { finishText(); return }
        systemPalette = false; updateMenu()
        if name != "text", name != toolName(canvas.tool) {
            previousTool = canvas.tool; previousToolName = toolName(canvas.tool)
        }
        activeTool = name; typing = name == "text"
        switch name {
        case "marker": canvas.tool = PKInkingTool(.marker, color: inkColor.withAlphaComponent(0.3), width: 24)
        case "eraser": canvas.tool = PKEraserTool(.vector)
        case "lasso": canvas.tool = PKLassoTool()
        case "pen": canvas.tool = PKInkingTool(.pen, color: inkColor, width: penWidth)
        default: break
        }
        modeChanged()
    }
    private func showPalette() {
        systemPalette = true; typing = false
        toolPickerSelectedToolDidChange(picker); modeChanged(); updateMenu()
    }
    private func pencilAction(_ action: UIPencilPreferredAction) {
        guard !closed, !systemPalette, presentedViewController == nil else { return }
        switch action {
        case .switchEraser, .switchPrevious:
            let old = canvas.tool, oldName = toolName(canvas.tool)
            if action == .switchEraser && !(canvas.tool is PKEraserTool) {
                canvas.tool = PKEraserTool(.vector); activeTool = "eraser"
            } else { canvas.tool = previousTool; activeTool = previousToolName }
            previousTool = old; previousToolName = oldName; typing = false
            modeChanged()
        case .showColorPalette, .showInkAttributes: showPalette()
        default:
            if #available(iOS 17.5, *), action == .showContextualPalette { showPalette() }
        }
    }
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) { pencilAction(UIPencilInteraction.preferredTapAction) }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) { pencilAction(UIPencilInteraction.preferredTapAction) }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { pencilAction(UIPencilInteraction.preferredSqueezeAction) }
    }
    private func refreshTools() {
        for (name, button) in toolButtons {
            let selected = name == activeTool
            button.viewWithTag(33)?.isHidden = !selected
            button.accessibilityTraits = selected ? [.button, .selected] : .button
            button.alpha = selected || name == "back" ? 1 : 0.65
        }
        toolButtons["undo"]?.isEnabled = canvas.undoManager?.canUndo == true
        toolButtons["redo"]?.isEnabled = canvas.undoManager?.canRedo == true
        if let text = toolButtons["text"] {
            text.setImage(UIImage(systemName: editingItem == nil ? "textformat" : "keyboard.chevron.compact.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18)), for: .normal)
            text.accessibilityLabel = editingItem == nil ? "Text" : "Finish typing"
        }
        if let pen = toolButtons["pen"] {
            pen.showsMenuAsPrimaryAction = activeTool == "pen"
            pen.menu = UIMenu(children: [1.5, 2.5, 4.5].map { width in
                UIAction(title: width == 1.5 ? "Fine" : width == 2.5 ? "Medium" : "Bold", state: penWidth == width ? .on : .off) { [weak self] _ in self?.penWidth = width; self?.chooseTool("pen") }
            })
        }
    }
    private func updateMenu() {
        let styles = ["plain", "ruled", "dotted"].map { style in
            UIAction(title: style.capitalized + " paper", state: (paper.style ?? "ruled") == style ? .on : .off) { [weak self] _ in
                guard let self = self else { return }; self.paper.style = style; self.drawPaper(); self.updateMenu(); self.modified()
            }
        }
        var actions: [UIMenuElement] = [UIMenu(options: .displayInline, children: styles)]
        if UIDevice.current.userInterfaceIdiom == .phone {
            actions.append(UIMenu(options: .displayInline, children: ["marker", "eraser", "lasso", "undo", "redo"].map { name in
                UIAction(title: name == "marker" ? "Highlighter" : name.capitalized) { [weak self] _ in self?.chooseTool(name) }
            }))
        }
        actions += [
            UIAction(title: "All pens…", image: UIImage(systemName: "pencil.tip.crop.circle")) { [weak self] _ in
                self?.showPalette()
            },
            UIAction(title: "Add paper", image: UIImage(systemName: "plus")) { [weak self] _ in self?.extendPaper() },
            UIAction(title: "Fit width") { [weak self] _ in self?.fitPaper() },
            UIAction(title: "Actual size") { [weak self] _ in self?.scroll.setZoomScale(1, animated: true) }
        ]
        if systemPalette { actions.insert(UIAction(title: "Hide pen palette") { [weak self] _ in self?.systemPalette = false; self?.modeChanged(); self?.updateMenu() }, at: 1) }
        moreButton.menu = UIMenu(children: actions); moreButton.accessibilityLabel = "Notebook options"
    }
    private func drawPaper() {
        let path = UIBezierPath(), edge = UIBezierPath()
        let style = paper.style ?? "ruled"
        if style != "plain" {
            if style == "dotted" {
                for y in stride(from: 130.0, through: paper.height + 112, by: 36) {
                    for x in stride(from: 18.0, through: paper.width, by: 36) { path.append(UIBezierPath(ovalIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))) }
                }
            } else { for y in stride(from: 147.0, through: paper.height + 112, by: 36) { path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: paper.width, y: y)) } }
            edge.move(to: CGPoint(x: 96, y: 112)); edge.addLine(to: CGPoint(x: 96, y: paper.height + 112))
        }
        edge.move(to: CGPoint(x: 0, y: 112)); edge.addLine(to: CGPoint(x: paper.width, y: 112))
        ruling.path = path.cgPath
        ruling.fillColor = style == "dotted" ? paperInk.withAlphaComponent(0.15).cgColor : nil
        ruling.strokeColor = style == "dotted" ? nil : paperInk.withAlphaComponent(0.12).cgColor; ruling.lineWidth = 1
        margin.path = edge.cgPath; margin.fillColor = nil; margin.strokeColor = paperInk.withAlphaComponent(0.15).cgColor; margin.lineWidth = 1
    }
    private func toolName(_ tool: PKTool) -> String {
        if let ink = tool as? PKInkingTool { return ink.inkType == .marker ? "marker" : "pen" }
        return tool is PKEraserTool ? "eraser" : "lasso"
    }
    func toolPickerSelectedToolDidChange(_ toolPicker: PKToolPicker) {
        guard systemPalette else { return }
        let tool = toolPicker.selectedTool
        if let ink = tool as? PKInkingTool {
            inkColor = ink.color.withAlphaComponent(1); activeTool = ink.inkType == .marker ? "marker" : "pen"
            if ink.inkType == .pen { penWidth = ink.width }
        } else { activeTool = tool is PKEraserTool ? "eraser" : "lasso" }
        canvas.tool = tool; refreshTools()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let fit = max(0.1, min(1, scroll.bounds.width / paper.width))
        scroll.minimumZoomScale = fit
        if !fitted && scroll.bounds.width > 0 { scroll.zoomScale = fit; fitted = true; centerPaper(); scroll.contentOffset = CGPoint(x: -scroll.contentInset.left, y: -scroll.contentInset.top) }
        centerPaper()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        modeChanged()
        changed(paper)
        let initial = action; action = "write"
        if initial == "record" { record() }
        if initial == "photo" { photo() }
    }
    override func viewWillDisappear(_ animated: Bool) {
        picker.setVisible(false, forFirstResponder: canvas)
        super.viewWillDisappear(animated)
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { page }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerPaper(); layoutSelection() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { layoutSelection() }
    private func centerPaper() {
        let side = max(0, (scroll.bounds.width - paper.width * scroll.zoomScale) / 2)
        scroll.contentInset = UIEdgeInsets(top: 0, left: side, bottom: systemPalette && !typing ? 140 : 32, right: side)
    }
    private func fitPaper() {
        scroll.setZoomScale(max(0.1, min(1, scroll.bounds.width / paper.width)), animated: true)
    }
    private func layoutPaper() {
        let scale = scroll.zoomScale
        scroll.zoomScale = 1
        page.frame = CGRect(x: 0, y: 0, width: paper.width, height: paper.height + 112)
        heading.frame = CGRect(x: 112, y: 24, width: paper.width - 152, height: 40)
        subtitle.frame = CGRect(x: 112, y: 64, width: paper.width - 152, height: 24)
        sheet.frame = CGRect(x: 0, y: 112, width: paper.width, height: paper.height)
        drawPaper()
        canvas.frame = sheet.bounds
        canvas.contentSize = sheet.bounds.size
        scroll.contentSize = page.bounds.size
        scroll.zoomScale = scale
    }
    @objc private func modeChanged() {
        view.endEditing(true)
        let pen = !typing
        canvas.isUserInteractionEnabled = pen
        itemViews.values.forEach { $0.isUserInteractionEnabled = !pen }
        selected = nil
        movingItem = nil
        editingItem = nil
        editMenu.dismissMenu()
        showSelection()
        picker.setVisible(pen && systemPalette, forFirstResponder: canvas)
        if pen { canvas.becomeFirstResponder() } else { canvas.resignFirstResponder() }
        centerPaper(); refreshTools()
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if gestureRecognizer is PaperDrag { return typing && editingItem == nil }
        return typing && !itemViews.values.contains { touch.view?.isDescendant(of: $0) == true }
    }
    @objc private func placeText(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: sheet)
        if let id = movingItem, let index = paper.items.firstIndex(where: { $0.id == id }), let box = itemViews[id] {
            rememberItems()
            paper.items[index].x = max(0, min(paper.width - box.bounds.width, point.x))
            paper.items[index].y = max(44, min(paper.height - box.bounds.height - 44, point.y))
            box.frame.origin = CGPoint(x: paper.items[index].x, y: paper.items[index].y)
            movingItem = nil; showSelection(); modified(); return
        }
        if selected != nil { finishText(); return }
        addText("", at: point)
    }
    private func addText(_ text: String, at point: CGPoint, id: String = UUID().uuidString) {
        rememberItems()
        let x = point.x < 160 ? 112 : max(24, min(point.x, paper.width - 200)), y = max(8, min(round((point.y - 24) / 36) * 36 + 8, paper.height - 100))
        let item = PaperItem(id: id, kind: "text", x: x, y: y, width: min(560, paper.width - x - 24, max(240, (scroll.bounds.width - 40) / 0.75)), height: 70, text: text, fontSize: 24)
        paper.items.append(item)
        renderItem(item)
        if let view = itemViews[item.id]?.viewWithTag(1) as? UITextView { textViewDidChange(view) }
        modified()
        if text.isEmpty {
            selected = item.id
            beginEditing(item.id)
        }
    }
    private func renderItems() {
        itemViews.values.forEach { $0.removeFromSuperview() }; itemViews = [:]
        paper.items.forEach(renderItem)
        showSelection()
    }
    private func sourceText(_ item: PaperItem) -> PaperItem? {
        item.kind == "text" ? nil : paper.items.first { $0.id == item.id + "-text" }
    }
    private func itemFrame(_ item: PaperItem) -> CGRect {
        if let text = sourceText(item) { return CGRect(x: max(8, text.x - 96), y: text.y, width: 72, height: item.kind == "audio" ? 68 : 64) }
        return CGRect(x: item.x, y: item.y, width: item.width, height: item.kind == "audio" ? 44 : item.height)
    }
    private func renderItem(_ item: PaperItem) {
        itemViews.removeValue(forKey: item.id)?.removeFromSuperview()
        let box = UIView(frame: itemFrame(item))
        box.accessibilityIdentifier = item.id
        box.isUserInteractionEnabled = typing
        if item.kind == "text" {
            let text = UITextView(frame: box.bounds)
            text.tag = 1; text.delegate = self
            text.accessibilityLabel = "Paper text"
            let paragraph = NSMutableParagraphStyle()
            paragraph.minimumLineHeight = (item.fontSize ?? 24) * 1.5
            paragraph.maximumLineHeight = paragraph.minimumLineHeight
            let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: item.fontSize ?? 24), .paragraphStyle: paragraph, .foregroundColor: paperInk]
            text.attributedText = NSAttributedString(string: item.text ?? "", attributes: attributes)
            text.typingAttributes = attributes
            text.isEditable = false; text.isSelectable = false
            text.textColor = paperInk
            text.backgroundColor = .clear
            text.isScrollEnabled = false
            text.textContainerInset = .zero
            text.textContainer.lineFragmentPadding = 0
            text.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            box.addSubview(text)
            box.frame.size.height = max(item.height, text.sizeThatFits(CGSize(width: item.width, height: 14000)).height)
        } else if item.kind == "image", let file = try? item.asset?.file(in: folder), let image = UIImage(contentsOfFile: file.path) {
            let view = UIImageView(image: image)
            view.frame = box.bounds; view.contentMode = sourceText(item) == nil ? .scaleAspectFit : .scaleAspectFill; view.clipsToBounds = true; view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            box.addSubview(view)
        } else if item.kind == "audio" {
            let play = UIButton(configuration: .plain())
            play.tag = 1; play.frame = box.bounds; play.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            play.accessibilityLabel = "Play recording"
            play.addAction(UIAction { [weak self] _ in self?.play(item) }, for: .touchUpInside)
            box.addSubview(play)
            if let file = try? item.asset?.file(in: folder) { durations[item.id] = (try? AVAudioPlayer(contentsOf: file))?.duration ?? 0 }
        }
        let moving = PaperDrag(target: self, action: #selector(moveItem(_:)))
        moving.coordinateSpace = sheet; moving.delegate = self
        box.addGestureRecognizer(moving)
        scroll.panGestureRecognizer.require(toFail: moving)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(itemMenu(_:)))
        box.addGestureRecognizer(hold)
        let select = UITapGestureRecognizer(target: self, action: #selector(selectItem(_:)))
        select.cancelsTouchesInView = false
        box.addGestureRecognizer(select)
        sheet.addSubview(box)
        sheet.bringSubviewToFront(canvas)
        itemViews[item.id] = box
        if item.kind == "audio" { updateAudio(item.id) }
        showSelection()
    }
    @objc private func selectItem(_ gesture: UITapGestureRecognizer) {
        guard let id = gesture.view?.accessibilityIdentifier, editingItem != id else { return }
        if selected == id, paper.items.first(where: { $0.id == id })?.kind == "text" { beginEditing(id); return }
        if let item = paper.items.first(where: { $0.id == id }), item.kind == "image", sourceText(item) != nil { openPhoto(item); return }
        view.endEditing(true); selected = id; showSelection()
    }
    private func openPhoto(_ item: PaperItem) {
        guard let url = try? item.asset?.file(in: folder), presentedViewController == nil else { return }
        previewFile = url as NSURL
        let preview = QLPreviewController(); preview.dataSource = self; preview.delegate = self
        present(preview, animated: true)
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewFile == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewFile! }
    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }
    private func beginEditing(_ id: String) {
        guard let text = itemViews[id]?.viewWithTag(1) as? UITextView else { return }
        if !text.text.isEmpty { rememberItems() }
        editMenu.dismissMenu(); selected = id; editingItem = id
        text.isEditable = true; text.isSelectable = true; text.becomeFirstResponder(); showSelection()
    }
    private func showSelection() { layoutSelection() }
    private func layoutSelection() {
        guard typing, let id = selected, let box = itemViews[id], let item = paper.items.first(where: { $0.id == id }) else {
            selectionBorder.isHidden = true; resizeKnob.isHidden = true; return
        }
        let rect = sheet.convert(box.frame, to: selectionOverlay)
        selectionBorder.frame = rect.insetBy(dx: -6, dy: -6)
        selectionBorder.isHidden = false
        selectionBorder.alpha = movingItem == id ? 0.4 : 1
        resizeKnob.isHidden = item.kind == "audio" || sourceText(item) != nil
        resizeKnob.accessibilityIdentifier = id
        resizeKnob.frame = CGRect(x: rect.maxX - 16, y: (item.kind == "text" ? rect.midY : rect.maxY) - 22, width: 44, height: 44)
        editMenu.updateVisibleMenuPosition(animated: false)
    }
    @objc private func itemMenu(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began, let id = gesture.view?.accessibilityIdentifier else { return }
        view.endEditing(true); selected = id; showSelection()
        editMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: id, sourcePoint: gesture.location(in: sheet)))
    }
    func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect {
        itemViews[selected ?? ""]?.frame ?? .null
    }
    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard let id = selected, let item = paper.items.first(where: { $0.id == id }) else { return nil }
        var actions: [UIMenuElement] = sourceText(item) == nil ? [UIAction(title: "Move…") { [weak self] _ in self?.movingItem = id; self?.showSelection() }] : []
        if item.kind == "text" { actions.insert(UIAction(title: "Edit") { [weak self] _ in self?.beginEditing(id) }, at: 0) }
        if item.kind == "audio" && !paper.items.contains(where: { $0.id == id + "-text" }) { actions.append(UIAction(title: "Transcribe") { [weak self] _ in self?.transcribe(item) }) }
        if item.kind == "image" {
            actions.append(UIAction(title: "Open original photo") { [weak self] _ in self?.openPhoto(item) })
            if sourceText(item) == nil { actions.append(UIAction(title: "Extract text") { [weak self] _ in self?.extractText(item) }) }
        }
        actions.append(UIAction(title: "Delete", attributes: .destructive) { [weak self] _ in self?.deleteSelected() })
        return UIMenu(children: actions)
    }
    @objc private func deleteSelected() {
        guard let id = selected, editingItem == nil else { return }
        rememberItems(); paper.items.removeAll { $0.id == id }; selected = nil; renderItems(); modified()
    }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer is PaperDrag else { return true }
        let item = paper.items.first { $0.id == gestureRecognizer.view?.accessibilityIdentifier }
        return typing && selected == item?.id && editingItem == nil && item.map({ sourceText($0) == nil }) == true
    }
    private func itemIndex(_ view: UIView?) -> Int? {
        guard let id = view?.superview?.accessibilityIdentifier else { return nil }
        return paper.items.firstIndex { $0.id == id }
    }
    func textViewDidBeginEditing(_ textView: UITextView) {
        selected = textView.superview?.accessibilityIdentifier
        refreshTools(); showSelection()
        if UIDevice.current.userInterfaceIdiom == .phone, let box = textView.superview {
            scroll.setZoomScale(min(2, max(0.75, (scroll.bounds.width - 32) / box.bounds.width)), animated: false)
        }
        if let box = textView.superview { scroll.scrollRectToVisible(sheet.convert(box.frame.insetBy(dx: -20, dy: -50), to: scroll), animated: true) }
    }
    func textViewDidEndEditing(_ textView: UITextView) {
        textView.isEditable = false; textView.isSelectable = false; editingItem = nil
        refreshTools()
        if let index = itemIndex(textView), textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            rememberItems(); let id = paper.items.remove(at: index).id
            itemViews.removeValue(forKey: id)?.removeFromSuperview(); selected = nil; modified()
        }
        if typing { chooseTool("pen") } else { showSelection() }
    }
    func textViewDidChange(_ textView: UITextView) {
        guard let index = itemIndex(textView), let box = textView.superview else { return }
        paper.items[index].text = textView.text
        let height = max(70, textView.sizeThatFits(CGSize(width: box.bounds.width, height: 14000)).height)
        paper.items[index].height = min(height, 14000 - paper.items[index].y)
        box.frame.size.height = paper.items[index].height
        grow(to: box.frame.maxY + 100)
        layoutSelection(); modified()
    }
    private func beginDrag(_ gesture: UIPanGestureRecognizer, box: UIView) -> (CGPoint, CGRect)? {
        if gesture.state == .began {
            rememberItems()
            let point = gesture.location(in: sheet), delta = gesture.translation(in: sheet)
            dragStart = ((gesture as? PaperDrag)?.startPoint ?? CGPoint(x: point.x - delta.x, y: point.y - delta.y), box.frame)
        }
        guard let start = dragStart else { return nil }
        let point = gesture.location(in: sheet)
        return (CGPoint(x: point.x - start.point.x, y: point.y - start.point.y), start.frame)
    }
    @objc private func moveItem(_ gesture: UIPanGestureRecognizer) {
        guard let id = gesture.view?.accessibilityIdentifier, let index = paper.items.firstIndex(where: { $0.id == id }), let box = itemViews[id],
              let (delta, frame) = beginDrag(gesture, box: box) else { return }
        paper.items[index].x = max(0, min(paper.width - box.bounds.width, frame.minX + delta.x))
        paper.items[index].y = max(44, min(paper.height - box.bounds.height - 44, frame.minY + delta.y))
        box.frame.origin = CGPoint(x: paper.items[index].x, y: paper.items[index].y)
        layoutSelection(); modified()
        if gesture.state == .ended { dragStart = nil; view.endEditing(true) }
    }
    @objc private func resizeItem(_ gesture: UIPanGestureRecognizer) {
        guard let id = gesture.view?.accessibilityIdentifier, let index = paper.items.firstIndex(where: { $0.id == id }), let box = itemViews[id],
              let (delta, frame) = beginDrag(gesture, box: box) else { return }
        paper.items[index].width = max(180, min(paper.width - frame.minX, frame.width + delta.x))
        box.frame.size.width = paper.items[index].width
        if let text = box.viewWithTag(1) as? UITextView { textViewDidChange(text) }
        else {
            paper.items[index].height = max(50, min(paper.height - frame.minY - 44, frame.height * box.frame.width / frame.width))
            box.frame.size.height = paper.items[index].height
            modified()
        }
        layoutSelection()
        if gesture.state == .ended { dragStart = nil; view.endEditing(true) }
    }
    private func rememberItems() {
        let old = paper.items
        canvas.undoManager?.registerUndo(withTarget: self) { target in target.rememberItems(); target.paper.items = old; target.renderItems(); target.modified() }
    }
    @objc private func undoEdit() {
        if !typing { canvas.undoManager?.undo() }
        else if let text = itemViews[selected ?? ""]?.viewWithTag(1) as? UITextView, text.isFirstResponder { text.undoManager?.undo() }
        else { canvas.undoManager?.undo() }
    }
    @objc private func redoEdit() {
        if !typing { canvas.undoManager?.redo() }
        else if let text = itemViews[selected ?? ""]?.viewWithTag(1) as? UITextView, text.isFirstResponder { text.undoManager?.redo() }
        else { canvas.undoManager?.redo() }
    }
    override var keyCommands: [UIKeyCommand]? { [
        UIKeyCommand(input: "r", modifierFlags: [.command, .shift], action: #selector(record)),
        UIKeyCommand(input: "\r", modifierFlags: .command, action: #selector(finishText)),
        UIKeyCommand(input: "s", modifierFlags: .command, action: #selector(saveNow)),
        UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(finishText))
    ] + (editingItem == nil ? [UIKeyCommand(input: "\u{8}", modifierFlags: [], action: #selector(deleteSelected))] : []) }
    @objc private func finishText() { chooseTool("pen") }
    @objc private func extendPaper() { grow(to: paper.height + 1400) }
    private func grow(to height: Double) {
        let next = min(14000, max(paper.height, ceil(height / 1400) * 1400))
        guard next > paper.height else { return }
        paper.height = next; inkDirty = true; layoutPaper(); modified()
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        inkDirty = true
        if !canvas.drawing.strokes.isEmpty { grow(to: canvas.drawing.bounds.maxY + 200) }
        modified()
    }
    private func modified() {
        dirty = true; refreshTools()
        for item in paper.items where item.kind != "text" {
            itemViews[item.id]?.frame = itemFrame(item)
            if item.kind == "image", let image = itemViews[item.id]?.subviews.first as? UIImageView { image.contentMode = sourceText(item) == nil ? .scaleAspectFit : .scaleAspectFill }
            if item.kind == "audio" { updateAudio(item.id) }
        }
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }
    private func store(_ bytes: Data, name: String, mime: String) throws -> PaperAsset {
        guard bytes.count <= 32 * 1024 * 1024 else { throw PaperError.message("This attachment exceeds 32 MiB. Keep it in a separate page.") }
        let filename = "\(UUID().uuidString).\((name as NSString).pathExtension)"
        try bytes.write(to: folder.appendingPathComponent(filename), options: .atomic)
        return PaperAsset(url: filename, name: name, size: bytes.count, mime: mime)
    }
    private func save() throws {
        saveWork?.cancel()
        guard dirty else { return }
        if inkDirty {
            let drawing = canvas.drawing
            let ink = try store(drawing.dataRepresentation(), name: "Paper.drawing", mime: "application/octet-stream")
            let bounds = CGRect(x: 0, y: 0, width: paper.width, height: paper.height)
            var image: UIImage!
            UITraitCollection(userInterfaceStyle: .light).performAsCurrent { image = drawing.image(from: bounds, scale: min(2, 8192 / paper.height)) }
            guard let bytes = image.pngData() else { throw PaperError.message("Couldn't save the ink preview.") }
            paper.inkBottom = drawing.strokes.isEmpty ? 0 : drawing.bounds.maxY
            paper.previewHeight = paper.height
            paper.ink = ink
            paper.preview = try store(bytes, name: "Paper.png", mime: "image/png")
        }
        paper.updatedAt = Date().timeIntervalSince1970 * 1000
        try JSONEncoder().encode(paper).write(to: draft, options: .atomic)
        dirty = false; inkDirty = false
        changed(paper)
    }
    @objc private func saveNow() {
        do { try save() } catch { showError("Couldn't save paper", error.localizedDescription, retry: { [weak self] in self?.saveNow() }) }
    }
    @objc private func background() { if recorder != nil { stopRecording() }; saveNow() }
    @objc private func done() {
        view.endEditing(true)
        if recorder != nil { stopRecording() }
        do {
            try save(); closed = true; transcriptionTask?.cancel()
            dismiss(animated: true) { self.finish(self.paper) }
        }
        catch { showError("Couldn't save paper", error.localizedDescription, retry: { [weak self] in self?.saveNow() }) }
    }
    private func showError(_ title: String, _ message: String, retry: (() -> Void)? = nil) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        if let retry = retry { alert.addAction(UIAlertAction(title: "Try Again", style: .default) { _ in retry() }) }
        alert.addAction(UIAlertAction(title: "OK", style: .cancel))
        present(alert, animated: true)
    }
    private func capturePoint() -> CGPoint {
        let visible = scroll.convert(CGPoint(x: 30, y: scroll.bounds.minY + 80), to: sheet)
        let inkBottom = canvas.drawing.strokes.isEmpty ? 0 : canvas.drawing.bounds.maxY
        let bottom = max(inkBottom, paper.items.map { itemFrame($0).maxY }.max() ?? 0)
        let y = max(60, max(visible.y, bottom + 32))
        grow(to: y + 700)
        return CGPoint(x: 112, y: min(y, paper.height - 700))
    }
    private func reveal(_ item: PaperItem) {
        let rect = CGRect(x: item.x, y: item.y, width: item.width, height: min(item.height, 300))
        scroll.scrollRectToVisible(sheet.convert(rect, to: scroll), animated: true)
    }
    @objc private func record() {
        if recorder != nil { stopRecording(); return }
        guard !requestingMic else { return }
        requestingMic = true; recordButton.isEnabled = false
        AVAudioSession.sharedInstance().requestRecordPermission { allowed in
            DispatchQueue.main.async {
                self.requestingMic = false; self.recordButton.isEnabled = true
                guard !self.closed else { return }
                guard allowed else { self.showError("Microphone access is off", "Allow LeadingLight in Settings → Privacy & Security → Microphone."); return }
                do {
                    self.player?.pause()
                    if let id = self.playingId { self.updateAudio(id) }
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                    try session.setActive(true)
                    let file = self.folder.appendingPathComponent("\(UUID().uuidString).m4a")
                    let recorder = try AVAudioRecorder(url: file, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
                    guard recorder.record() else { throw PaperError.message("The microphone could not start. Try again.") }
                    self.recorder = recorder
                    self.updateRecordingButton()
                    self.recordTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.updateRecordingButton() }
                } catch { self.showError("Couldn't record", error.localizedDescription) }
            }
        }
    }
    private func stopRecording() {
        guard let recording = recorder else { return }
        recording.stop(); recorder = nil; recordTimer?.invalidate(); recordTimer = nil; updateRecordingButton()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        do {
            let bytes = try Data(contentsOf: recording.url)
            let asset = PaperAsset(url: recording.url.lastPathComponent, name: "Recording.m4a", size: bytes.count, mime: "audio/mp4")
            let point = capturePoint()
            let item = PaperItem(id: UUID().uuidString, kind: "audio", x: point.x, y: point.y, width: 320, height: 44, asset: asset)
            rememberItems(); paper.items.append(item); renderItem(item); reveal(item); modified(); try save()
            transcribe(item)
        } catch { showError("Couldn't keep recording", error.localizedDescription) }
    }
    private func clock(_ duration: TimeInterval) -> String {
        let seconds = Int(max(0, duration.isFinite ? duration : 0))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
    private func updateRecordingButton() {
        cameraButton.isEnabled = recorder == nil
        guard let recorder = recorder else {
            recordButton.customView = nil; recordButton.image = UIImage(systemName: "mic")
            recordButton.accessibilityLabel = "Record"; return
        }
        var configuration = UIButton.Configuration.plain()
        configuration.baseForegroundColor = .systemRed
        configuration.image = UIImage(systemName: "stop.fill")
        configuration.title = clock(recorder.currentTime); configuration.imagePadding = 6
        let button = (recordButton.customView as? UIButton) ?? UIButton(configuration: configuration)
        button.configuration = configuration
        button.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        button.accessibilityLabel = "Stop recording"
        button.removeTarget(self, action: #selector(record), for: .touchUpInside)
        button.addTarget(self, action: #selector(record), for: .touchUpInside)
        recordButton.customView = button
    }
    private func updateAudio(_ id: String) {
        guard let button = itemViews[id]?.viewWithTag(1) as? UIButton else { return }
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: playingId == id && player?.isPlaying == true ? "pause.fill" : "play.fill")
        configuration.title = clock(durations[id] ?? 0)
        configuration.subtitle = captureStates[id]
        let paired = paper.items.first(where: { $0.id == id }).flatMap { sourceText($0) } != nil
        configuration.imagePlacement = paired ? .top : .leading
        configuration.imagePadding = paired ? 6 : 10; configuration.baseForegroundColor = paperInk
        configuration.contentInsets = .zero; button.contentHorizontalAlignment = .leading
        button.configuration = configuration
        button.titleLabel?.font = .monospacedDigitSystemFont(ofSize: paired ? 13 : 17, weight: .regular)
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if let id = playingId { updateAudio(id) }
    }
    private func play(_ item: PaperItem) {
        guard recorder == nil else { return }
        do {
            if playingId == item.id, let player = player {
                if player.isPlaying { player.pause() } else { player.play() }
            } else {
                guard let file = try item.asset?.file(in: folder) else { return }
                let previous = playingId
                try AVAudioSession.sharedInstance().setCategory(.playback)
                player = try AVAudioPlayer(contentsOf: file); player?.delegate = self; playingId = item.id; player?.play()
                if let previous = previous { updateAudio(previous) }
            }
            updateAudio(item.id)
        } catch { showError("Couldn't play recording", error.localizedDescription) }
    }
    private func photoStatus(_ id: String, _ message: String?) {
        guard let box = itemViews[id] else { return }
        box.viewWithTag(2)?.removeFromSuperview()
        guard let message = message else { return }
        let label = UILabel(frame: CGRect(x: 0, y: box.bounds.height + 4, width: box.bounds.width, height: 24))
        label.tag = 2; label.text = message; label.font = .systemFont(ofSize: 17); label.textColor = .secondaryLabel
        label.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]; box.addSubview(label)
    }
    private func extractText(_ item: PaperItem) {
        guard !recognizingPhoto, let asset = item.asset else { return }
        recognizingPhoto = true; photoStatus(item.id, "Reading text…")
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try recognizeImage(path: asset.file(in: self.folder).path) }
            DispatchQueue.main.async {
                self.recognizingPhoto = false
                guard !self.closed, self.paper.items.contains(where: { $0.id == item.id }) else { return }
                switch result {
                case .success(let text):
                    if text.isEmpty {
                        self.photoStatus(item.id, "No text found")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.photoStatus(item.id, nil) }
                    }
                    else if !self.paper.items.contains(where: { $0.id == item.id + "-text" }) { self.photoStatus(item.id, nil); self.addText(text, at: CGPoint(x: max(112, item.x), y: item.y), id: item.id + "-text"); self.saveNow() }
                case .failure(let error): self.photoStatus(item.id, "Couldn't read text"); self.showError("Couldn't read text", error.localizedDescription)
                }
            }
        }
    }
    private func transcribe(_ item: PaperItem) {
        guard !closed, let asset = item.asset else { return }
        if transcribing {
            if !pendingTranscriptions.contains(where: { $0.id == item.id }) { pendingTranscriptions.append(item); captureStates[item.id] = "Waiting to transcribe"; updateAudio(item.id) }
            return
        }
        guard !paper.items.contains(where: { $0.id == item.id + "-text" }) else { showError("Transcript already added", "Edit its text box on the paper."); return }
        guard #available(iOS 26.0, *) else { showError("Recording saved", "Transcription requires iOS or iPadOS 26 or newer."); return }
        transcribing = true; captureStates[item.id] = "Transcribing…"; updateAudio(item.id)
        transcriptionTask = Task { @MainActor in
            defer {
                self.transcribing = false; self.updateAudio(item.id)
                if !self.closed && !self.pendingTranscriptions.isEmpty { self.transcribe(self.pendingTranscriptions.removeFirst()) }
            }
            do {
                let text = try await recognizeSpeech(path: asset.file(in: folder).path, language: Locale.current.identifier)
                guard !closed, !Task.isCancelled, paper.items.contains(where: { $0.id == item.id }) else { return }
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { captureStates[item.id] = "No transcript"; showError("No speech found", "Your audio is saved. Hold the recording in Text to retry transcription.") }
                else { captureStates[item.id] = nil; addText(text, at: CGPoint(x: max(112, item.x), y: item.y), id: item.id + "-text"); try save() }
            } catch { if !closed && !Task.isCancelled { captureStates[item.id] = "No transcript"; showError("Recording saved", "\(error.localizedDescription) Hold the recording in Text to retry transcription.") } }
        }
    }
    @objc private func photo() {
        guard recorder == nil, presentedViewController == nil else { return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { showError("Camera unavailable", "This device has no available camera."); return }
        AVCaptureDevice.requestAccess(for: .video) { allowed in
            DispatchQueue.main.async {
                guard !self.closed else { return }
                guard allowed else { self.showError("Camera access is off", "Allow LeadingLight in Settings → Privacy & Security → Camera."); return }
                guard self.presentedViewController == nil else { return }
                self.view.endEditing(true)
                let camera = UIImagePickerController(); camera.sourceType = .camera; camera.cameraDevice = .rear
                camera.delegate = self; camera.modalPresentationStyle = .fullScreen
                self.present(camera, animated: true)
            }
        }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        do {
            guard let original = info[.originalImage] as? UIImage else { throw PaperError.message("The photo is missing. Try again.") }
            let scale = min(1, 3200 / max(original.size.width, original.size.height))
            let size = CGSize(width: original.size.width * scale, height: original.size.height * scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in original.draw(in: CGRect(origin: .zero, size: size)) }
            guard let bytes = image.jpegData(compressionQuality: 0.9) else { throw PaperError.message("Couldn't save the photo.") }
            let asset = try store(bytes, name: "Photo.jpg", mime: "image/jpeg")
            let point = capturePoint()
            let item = PaperItem(id: UUID().uuidString, kind: "image", x: point.x, y: point.y, width: 500, height: min(600, 500 * size.height / size.width), asset: asset)
            rememberItems(); paper.items.append(item); renderItem(item); reveal(item); modified(); try save()
            picker.dismiss(animated: true) { self.extractText(item) }
        } catch { picker.dismiss(animated: true) { self.showError("Couldn't save photo", error.localizedDescription) } }
    }
}
