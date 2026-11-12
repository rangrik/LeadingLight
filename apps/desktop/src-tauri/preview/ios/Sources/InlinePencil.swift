import Tauri
import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

struct InlinePencilBounds: Decodable {
    let x: Double, y: Double, width: Double, height: Double
    var valid: Bool { [x, y, width, height].allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 } && width > 0 && height > 0 && x + width <= 1.001 && y + height <= 1.001 }
    func rect(in size: CGSize) -> CGRect { CGRect(x: x * size.width, y: y * size.height, width: width * size.width, height: height * size.height) }
}

private struct PencilPoint: Encodable { let x: CGFloat, y: CGFloat, pressure: CGFloat }
private struct PencilInput: Encodable {
    let kind = "input"
    let phase: String
    let points: [PencilPoint]
    let width: CGFloat, height: CGFloat
}

private final class PencilStroke: UIGestureRecognizer {
    var accepts: ((CGPoint) -> Bool)?
    var changed: ((String, [PencilPoint]) -> Void)?
    private var tracked: UITouch?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard tracked == nil, let touch = touches.first(where: { $0.type == .pencil }), accepts?(touch.location(in: view)) == true else { state = .failed; return }
        tracked = touch; state = .began
        changed?("began", samples(touch, event))
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = tracked, touches.contains(touch) else { return }
        state = .changed; changed?("moved", samples(touch, event))
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = tracked, touches.contains(touch) else { return }
        tracked = nil; changed?("ended", samples(touch, event)); state = .ended
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { cancelStroke() }
    override func reset() { super.reset(); cancelStroke(resetState: false) }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    func cancelStroke(resetState: Bool = true) {
        guard tracked != nil else { return }
        tracked = nil; changed?("cancelled", [])
        if resetState { state = .cancelled }
    }
    private func samples(_ touch: UITouch, _ event: UIEvent) -> [PencilPoint] {
        (event.coalescedTouches(for: touch) ?? [touch]).map { sample in
            let point = sample.location(in: view)
            let force = sample.maximumPossibleForce > 0 ? sample.force / sample.maximumPossibleForce : 0.5
            return PencilPoint(x: point.x, y: point.y, pressure: force.isFinite ? min(1, max(0.05, force)) : 0.5)
        }
    }
}

final class InlinePencil: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    private weak var webview: WKWebView?
    private let available: () -> Bool
    private let stroke = PencilStroke()
    private let pencil = UIPencilInteraction()
    private var bounds: InlinePencilBounds?
    private var channel: Channel?
    private var enabled = false
    private var drawingSize: CGSize?

    init(webview: WKWebView, available: @escaping () -> Bool) {
        self.webview = webview; self.available = available
        super.init()
        stroke.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        stroke.requiresExclusiveTouchType = true
        stroke.cancelsTouchesInView = true; stroke.delaysTouchesBegan = true
        stroke.isEnabled = false; stroke.delegate = self
        stroke.accepts = { [weak self] point in
            guard let self = self, self.canDraw, let bounds = self.bounds, let webview = self.webview else { return false }
            return bounds.rect(in: webview.bounds.size).contains(point)
        }
        stroke.changed = { [weak self] phase, points in self?.send(phase, points) }
        pencil.delegate = self; pencil.isEnabled = false
        webview.addGestureRecognizer(stroke); webview.addInteraction(pencil)
        NotificationCenter.default.addObserver(self, selector: #selector(suspend), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit {
        webview?.removeGestureRecognizer(stroke); webview?.removeInteraction(pencil)
        NotificationCenter.default.removeObserver(self)
    }
    private var canDraw: Bool { enabled && webview?.window != nil && webview?.isLoading == false && UIApplication.shared.applicationState == .active && available() }
    func configure(enabled: Bool, bounds: InlinePencilBounds?, channel: Channel) {
        let old = self.bounds, size = webview?.bounds.size ?? .zero
        if !enabled || self.channel?.id != channel.id || old?.rect(in: size) != bounds?.rect(in: size) { stroke.cancelStroke() }
        self.enabled = enabled; self.bounds = bounds; self.channel = enabled ? channel : nil
        stroke.isEnabled = enabled; pencil.isEnabled = enabled
    }
    @objc func suspend() { stroke.cancelStroke() }
    func shutdown() {
        stroke.cancelStroke(); enabled = false; channel = nil; bounds = nil
        stroke.isEnabled = false; pencil.isEnabled = false
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        canDraw && touch.type == .pencil && stroke.accepts?(touch.location(in: webview)) == true
    }
    private func send(_ phase: String, _ points: [PencilPoint]) {
        guard let webview = webview, let channel = channel else { return }
        if phase == "began" { drawingSize = webview.bounds.size }
        if phase != "cancelled", !canDraw || drawingSize != webview.bounds.size {
            if phase == "ended" { send("cancelled", []) } else { stroke.cancelStroke() }
            return
        }
        try? channel.send(PencilInput(phase: phase, points: points, width: webview.bounds.width, height: webview.bounds.height))
        if phase == "ended" || phase == "cancelled" { drawingSize = nil }
    }
    private func action(_ value: UIPencilPreferredAction) {
        guard canDraw else { return }
        let name: String
        switch value {
        case .switchEraser: name = "eraser"
        case .switchPrevious: name = "previous"
        case .showColorPalette, .showInkAttributes: name = "palette"
        default:
            if #available(iOS 17.5, *), value == .showContextualPalette { name = "palette" } else { return }
        }
        stroke.cancelStroke()
        try? channel?.send(["kind": "action", "action": name])
    }
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) { action(UIPencilInteraction.preferredTapAction) }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) { action(UIPencilInteraction.preferredTapAction) }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { action(UIPencilInteraction.preferredSqueezeAction) }
    }
}
