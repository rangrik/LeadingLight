// The browser space's pages (features/browser-space.feature): one native web view (WKWebView) per
// tab, laid over the page area. Agents keep their streamed Chromium tabs.
//
// Each view is made with wry, as Tauri makes its own, but Tauri never sees it: pages get no
// __TAURI_INTERNALS__, no IPC and none of Tauri's protocols, and the main window keeps its single
// webview (Tauri's multi-webview mode would make the notes webview a child view, which changes how
// ⌘ keys reach it). AppKit objects are used on the main thread only, where Tauri runs sync commands.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use block2::{Block, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSColor, NSEvent, NSEventMask, NSEventModifierFlags, NSImage, NSImageCompressionFactor, NSPasteboard,
    NSPasteboardAccessBehavior, NSPasteboardDetectionPatternProbableWebURL, NSPasteboardTypeString, NSResponder, NSWindow,
};
use objc2_foundation::{
    ns_string, NSBundle, NSDictionary, NSError, NSKeyValueObservingOptions, NSNumber, NSObjectNSKeyValueObserverRegistration,
    NSObjectProtocol, NSPoint, NSProcessInfo, NSRect, NSSet, NSSize, NSString, NSURLErrorCancelled,
};
use objc2_quartz_core::CACornerMask;
use objc2_web_kit::{
    WKContentWorld, WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKNavigationResponse,
    WKNavigationResponsePolicy, WKNavigationType, WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Url};
use tokio::sync::oneshot;
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::raw_window_handle as rwh;
use wry::{
    NewWindowResponse, PermissionResponse, Rect, WebView, WebViewBuilder, WebViewBuilderExtDarwin, WebViewBuilderExtMacos,
    WebViewExtMacOS,
};

// The pages' own website data, apart from the notes webview's, kept across restarts.
const STORE: [u8; 16] = [0x05, 0xe8, 0xcc, 0x05, 0xf5, 0x92, 0x49, 0x8f, 0xba, 0xb1, 0x31, 0xdb, 0x68, 0xee, 0x54, 0xe6];
const STATE: &str = "native-browser://state";
const ICON: &str = "native-browser://icon";
const OPENED: &str = "native-browser://opened";
const REFUSED: &str = "Use an http or https address without sign-in details.";
const OFF_MAIN: &str = "The native page is used from the main thread only.";
// WebKit tells of these changes itself (key-value observing on the view).
const WATCHED: [&str; 6] = ["URL", "title", "loading", "estimatedProgress", "canGoBack", "canGoForward"];
// Big enough for any favicon, small enough to keep with the tab in the app's storage.
const ICON_BYTES: usize = 24 * 1024;
// Asks the page which icon it names; a site that names none still has /favicon.ico.
const FIND_ICON: &str = r#"(() => { const l = [...document.querySelectorAll('link[rel~="icon" i]')].sort((a, b) => Math.abs((parseInt(a.sizes?.value) || 32) - 32) - Math.abs((parseInt(b.sizes?.value) || 32) - 32))[0] || document.querySelector('link[rel="apple-touch-icon" i]'); return l ? l.href : new URL("/favicon.ico", location.href).href; })()"#;

struct View {
    web: WebView,
    watch: Retained<Watch>,
    focus_monitor: Option<Retained<AnyObject>>,
}

impl Drop for View {
    fn drop(&mut self) {
        if let Some(monitor) = &self.focus_monitor {
            unsafe { NSEvent::removeMonitor(monitor) };
        }
    }
}

thread_local! {
    static VIEWS: RefCell<HashMap<String, View>> = RefCell::new(HashMap::new());
}

static ICONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[derive(Clone, PartialEq, Serialize)]
struct State {
    id: String,
    url: String,
    title: String,
    loading: bool,
    progress: f64,
    back: bool,
    forward: bool,
    // Why the last load failed, in WebKit's words.
    failed: Option<String>,
}

#[derive(Clone, Serialize)]
struct Opened {
    // Empty when the app is to open the tab itself (a ⌘-click).
    id: String,
    opener: String,
    url: String,
    front: bool,
}

#[derive(Clone, Serialize)]
struct Icon {
    id: String,
    icon: String,
}

struct Ivars {
    app: AppHandle,
    id: String,
    wry: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
    // The address last asked for in the main frame, and why it failed to load, if it did.
    asked: RefCell<String>,
    failed: RefCell<Option<String>>,
    sent: RefCell<Option<State>>,
}

define_class!(
    // One per page: WebKit's change notices, and its navigation delegate, which takes what the app
    // needs (⌘-clicks, failed loads) and passes the rest on to wry's.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LeadingLightPageWatch"]
    #[ivars = Ivars]
    struct Watch;

    unsafe impl NSObjectProtocol for Watch {}

    impl Watch {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe(&self, _path: Option<&NSString>, _object: Option<&AnyObject>, _change: Option<&AnyObject>, _context: *mut c_void) {
            self.changed();
        }
    }

    unsafe impl WKNavigationDelegate for Watch {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide(&self, web: &WKWebView, action: &WKNavigationAction, handler: &Block<dyn Fn(WKNavigationActionPolicy)>) {
            let url = unsafe { action.request().URL() }.and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default();
            let flags = unsafe { action.modifierFlags() };
            let link = unsafe { action.navigationType() } == WKNavigationType::LinkActivated;
            if link && flags.contains(NSEventModifierFlags::Command) && web_url(&url).is_some() {
                let opened = Opened { id: String::new(), opener: self.ivars().id.clone(), url, front: flags.contains(NSEventModifierFlags::Shift) };
                let _ = self.ivars().app.emit_to("main", OPENED, opened);
                return handler.call((WKNavigationActionPolicy::Cancel,));
            }
            if unsafe { action.targetFrame() }.is_some_and(|f| unsafe { f.isMainFrame() }) && web_url(&url).is_some() {
                *self.ivars().asked.borrow_mut() = url;
            }
            unsafe { msg_send![&*self.ivars().wry, webView: web, decidePolicyForNavigationAction: action, decisionHandler: handler] }
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn respond(&self, web: &WKWebView, response: &WKNavigationResponse, handler: &Block<dyn Fn(WKNavigationResponsePolicy)>) {
            unsafe { msg_send![&*self.ivars().wry, webView: web, decidePolicyForNavigationResponse: response, decisionHandler: handler] }
        }

        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn started(&self, _web: &WKWebView, _navigation: Option<&WKNavigation>) {
            *self.ivars().failed.borrow_mut() = None;
            self.changed();
        }

        #[unsafe(method(webView:didCommitNavigation:))]
        fn committed(&self, web: &WKWebView, navigation: Option<&WKNavigation>) {
            unsafe { msg_send![&*self.ivars().wry, webView: web, didCommitNavigation: navigation] }
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn finished(&self, web: &WKWebView, navigation: Option<&WKNavigation>) {
            unsafe { msg_send![&*self.ivars().wry, webView: web, didFinishNavigation: navigation] }
            self.find_icon(web);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn failed_early(&self, _web: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            self.fail(error);
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn failed_late(&self, _web: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            self.fail(error);
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn crashed(&self, _web: &WKWebView) {
            *self.ivars().failed.borrow_mut() = Some("This page stopped working.".into());
            self.changed();
        }
    }
);

impl Watch {
    fn new(app: AppHandle, id: String, wry: Retained<ProtocolObject<dyn WKNavigationDelegate>>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars { app, id, wry, asked: RefCell::default(), failed: RefCell::default(), sent: RefCell::default() });
        unsafe { msg_send![super(this), init] }
    }

    // Notices can come from inside a call that holds the views; tick only borrows them to read.
    fn changed(&self) {
        tick(&self.ivars().app, &self.ivars().id);
    }

    fn fail(&self, error: &NSError) {
        let (domain, code) = (error.domain().to_string(), error.code());
        // Another load took over, or WebKit handed the load to a plug-in or a download.
        if (domain == "NSURLErrorDomain" && code == NSURLErrorCancelled) || (domain == "WebKitErrorDomain" && matches!(code, 102 | 204)) {
            return;
        }
        *self.ivars().failed.borrow_mut() = Some(error.localizedDescription().to_string());
        self.changed();
    }

    fn find_icon(&self, web: &WKWebView) {
        let (app, id) = (self.ivars().app.clone(), self.ivars().id.clone());
        let done = RcBlock::new(move |found: *mut AnyObject, _: *mut NSError| {
            let href = unsafe { found.as_ref() }.and_then(|f| f.downcast_ref::<NSString>()).map(|s| s.to_string());
            if let Some(href) = href {
                fetch_icon(app.clone(), id.clone(), href);
            }
        });
        unsafe { web.evaluateJavaScript_completionHandler(&NSString::from_str(FIND_ICON), Some(&done)) };
    }
}

// wry adds a child view to the view in this handle: the main window's content view, which holds
// the notes webview, so pages sit on top of it.
struct Parent(NonNull<c_void>);

impl rwh::HasWindowHandle for Parent {
    fn window_handle(&self) -> Result<rwh::WindowHandle<'_>, rwh::HandleError> {
        let raw = rwh::RawWindowHandle::AppKit(rwh::AppKitWindowHandle::new(self.0));
        Ok(unsafe { rwh::WindowHandle::borrow_raw(raw) })
    }
}

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// Web pages only, with no user name or password in the address: never javascript:, data: or file:.
fn web_url(url: &str) -> Option<Url> {
    let url = Url::parse(url).ok()?;
    let web = matches!(url.scheme(), "http" | "https") && url.has_host();
    (web && url.username().is_empty() && url.password().is_none()).then_some(url)
}

// Frames inside a page also load about:blank, about:srcdoc and blob: documents of its own.
fn may_navigate(url: &str) -> bool {
    web_url(url).is_some() || url.starts_with("about:") || url.starts_with("blob:")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn with_view<T>(id: &str, f: impl FnOnce(&View) -> Result<T, String>) -> Result<T, String> {
    MainThreadMarker::new().ok_or(OFF_MAIN)?;
    VIEWS.with(|views| {
        let views = views.try_borrow().map_err(|_| "The native page is busy.")?;
        f(views.get(id).ok_or("No native page is open.")?)
    })
}

fn info(bundle: Option<Retained<NSBundle>>, key: &NSString) -> Option<String> {
    Some(bundle?.objectForInfoDictionaryKey(key)?.downcast::<NSString>().ok()?.to_string())
}

// Safari's own user agent on this Mac: the version is read from Safari; Apple froze the rest.
fn safari_agent() -> &'static str {
    static AGENT: OnceLock<String> = OnceLock::new();
    AGENT.get_or_init(|| {
        let os = NSProcessInfo::processInfo().operatingSystemVersion().majorVersion;
        let safari = NSBundle::bundleWithPath(ns_string!("/Applications/Safari.app"));
        let version = info(safari, ns_string!("CFBundleShortVersionString")).unwrap_or_else(|| format!("{os}.0"));
        format!("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15")
    })
}

// The page's address, title, loading and history, sent when they change. A failed load keeps
// the address that was asked for, so the pill shows it.
fn tick(app: &AppHandle, id: &str) {
    let changed = with_view(id, |view| {
        let page = view.web.webview();
        let watch = view.watch.ivars();
        let failed = watch.failed.borrow().clone();
        let mut url = unsafe { page.URL() }.and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default();
        if failed.is_some() && !watch.asked.borrow().is_empty() {
            url = watch.asked.borrow().clone();
        }
        let state = unsafe {
            State {
                id: id.to_string(),
                url,
                title: page.title().map(|s| s.to_string()).unwrap_or_default(),
                loading: page.isLoading(),
                progress: (page.estimatedProgress() * 100.0).round() / 100.0,
                back: page.canGoBack(),
                forward: page.canGoForward(),
                failed,
            }
        };
        if watch.sent.borrow().as_ref() == Some(&state) {
            return Ok(None);
        }
        *watch.sent.borrow_mut() = Some(state.clone());
        Ok(Some(state))
    });
    if let Ok(Some(state)) = changed {
        let _ = app.emit_to("main", STATE, state);
    }
}

// A page that is hidden or gone cannot keep the keyboard: it goes back to the notes webview,
// so the Edit menu and anything opened over the page act on the notes again.
fn give_back_keys(app: &AppHandle, view: &View) {
    let page = view.web.webview();
    let responder = page.window().and_then(|w| w.firstResponder());
    if !responder.is_some_and(|r| std::ptr::addr_eq(Retained::as_ptr(&r), Retained::as_ptr(&page))) {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.with_webview(|notes| unsafe {
            if let (Some(window), Some(notes)) = ((notes.ns_window() as *const NSWindow).as_ref(), (notes.inner() as *const NSResponder).as_ref()) {
                window.makeFirstResponder(Some(notes));
            }
        });
    }
}

fn build(app: &AppHandle, id: &str, url: Option<&str>, opener: Option<Retained<WKWebViewConfiguration>>) -> Result<View, String> {
    let mtm = MainThreadMarker::new().ok_or(OFF_MAIN)?;
    if NSProcessInfo::processInfo().operatingSystemVersion().majorVersion < 14 {
        return Err("The browser needs macOS 14 or later, for website data of its own.".into());
    }
    let main = app.get_webview_window("main").ok_or("The main window is gone.")?;
    let window = main.ns_window().map_err(text)? as *const NSWindow;
    let content = unsafe { window.as_ref() }.and_then(|w| w.contentView()).ok_or("The main window has no content view.")?;
    let (handle, me) = (app.clone(), id.to_string());
    let mut builder = WebViewBuilder::new()
        .with_bounds(Rect { position: LogicalPosition::new(0, 0).into(), size: LogicalSize::new(1, 1).into() })
        .with_visible(false)
        .with_focused(false)
        .with_user_agent(safari_agent())
        .with_navigation_handler(|to| may_navigate(&to))
        // The app has no camera permission, and macOS ends an app that uses one without it.
        .with_permission_handler(|_| PermissionResponse::Deny)
        .with_new_window_req_handler(move |to, features| popup(&handle, &me, &to, features.opener.target_configuration))
        .with_data_store_identifier(STORE);
    if let Some(url) = url {
        builder = builder.with_url(url);
    }
    if let Some(config) = opener {
        builder = builder.with_webview_configuration(config);
    }
    let web = builder.build_as_child(&Parent(NonNull::from(&*content).cast())).map_err(text)?;
    let page = web.webview();
    // Safari's Develop menu can inspect a page in debug builds, in a window of its own.
    #[cfg(debug_assertions)]
    unsafe {
        page.setInspectable(true)
    };
    let wry = unsafe { page.navigationDelegate() }.ok_or("The page has no navigation delegate.")?;
    let watch = Watch::new(app.clone(), id.to_string(), wry, mtm);
    unsafe {
        page.setNavigationDelegate(Some(ProtocolObject::from_ref(&*watch)));
        for key in WATCHED {
            page.addObserver_forKeyPath_options_context(&watch, &NSString::from_str(key), NSKeyValueObservingOptions::empty(), std::ptr::null_mut());
        }
    }
    // A native page's clicks never reach React, so tell the pane store where the keyboard went.
    let (handle, me) = (app.clone(), id.to_string());
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        let event_ref = unsafe { event.as_ref() };
        let hit = VIEWS.with(|views| {
            let Ok(views) = views.try_borrow() else { return false };
            let Some(view) = views.get(&me) else { return false };
            let page = view.web.webview();
            if page.isHiddenOrHasHiddenAncestor() || page.window() != event_ref.window(mtm) { return false; }
            let point = page.convertPoint_fromView(event_ref.locationInWindow(), None);
            let bounds = page.bounds();
            point.x >= bounds.origin.x && point.y >= bounds.origin.y
                && point.x < bounds.origin.x + bounds.size.width && point.y < bounds.origin.y + bounds.size.height
        });
        if hit { let _ = handle.emit_to("main", "native-browser://focused", &me); }
        event.as_ptr()
    });
    let focus_monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown, &handler) };
    Ok(View { web, watch, focus_monitor })
}

fn keep(id: String, view: View) -> Result<(), String> {
    VIEWS.with(|views| views.try_borrow_mut().map(|mut v| v.insert(id, view)).map(drop).map_err(|_| "The native page is busy.".into()))
}

// A page's own new window opens as a tab after its opener, made from the opener's settings so the
// two can still talk (a sign-in window answers its page).
fn popup(app: &AppHandle, opener: &str, to: &str, config: Retained<WKWebViewConfiguration>) -> NewWindowResponse {
    if !to.is_empty() && !may_navigate(to) {
        return NewWindowResponse::Deny;
    }
    let id = format!("w-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
    let Ok(view) = build(app, &id, None, Some(config)) else { return NewWindowResponse::Deny };
    let webview = Retained::into_super(view.web.webview());
    if keep(id.clone(), view).is_err() {
        return NewWindowResponse::Deny;
    }
    let _ = app.emit_to("main", OPENED, Opened { id, opener: opener.into(), url: to.into(), front: true });
    NewWindowResponse::Create { webview }
}

fn fetch_icon(app: AppHandle, id: String, href: String) {
    let Some(url) = web_url(&href) else { return };
    let cache = ICONS.get_or_init(Default::default);
    if let Some(icon) = cache.lock().ok().and_then(|c| c.get(url.as_str()).cloned()) {
        let _ = app.emit_to("main", ICON, Icon { id, icon });
        return;
    }
    let agent = safari_agent().to_string();
    tauri::async_runtime::spawn(async move {
        let key = url.to_string();
        if let Some(icon) = download_icon(url, agent).await {
            if let Ok(mut c) = cache.lock() {
                c.insert(key, icon.clone());
            }
            let _ = app.emit_to("main", ICON, Icon { id, icon });
        }
    });
}

// A data URL for the icon, by what its bytes are, not what the server calls them.
async fn download_icon(url: Url, agent: String) -> Option<String> {
    let client = reqwest::Client::builder().user_agent(agent).timeout(Duration::from_secs(8)).build().ok()?;
    let mut res = client.get(url).send().await.ok()?.error_for_status().ok()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > ICON_BYTES {
            return None;
        }
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
    let mime = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0, 0, 1, 0, ..] => "image/x-icon",
        [0xff, 0xd8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ if head.contains("<svg") => "image/svg+xml",
        _ => return None,
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

// The page sits exactly on the rect the app gives in CSS pixels, with its bottom corners rounded
// as the card's. width is the notes webview's in CSS pixels: it differs from points when zoomed.
fn place(page: &WKWebView, x: f64, y: f64, w: f64, h: f64, width: f64, radius: f64) {
    let Some(parent) = (unsafe { page.superview() }) else { return };
    let frame = parent.frame();
    let scale = if width > 0.0 { frame.size.width / width } else { 1.0 };
    let (x, y, w, h) = (x * scale, y * scale, (w * scale).max(1.0), (h * scale).max(1.0));
    let top = if parent.isFlipped() { y } else { frame.size.height - y - h };
    page.setFrame(NSRect::new(NSPoint::new(x, top), NSSize::new(w, h)));
    page.setWantsLayer(true);
    if let Some(layer) = page.layer() {
        let bottom = if layer.contentsAreFlipped() {
            CACornerMask::LayerMinXMaxYCorner | CACornerMask::LayerMaxXMaxYCorner
        } else {
            CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMaxXMinYCorner
        };
        layer.setCornerRadius(radius * scale);
        layer.setMaskedCorners(bottom);
        layer.setMasksToBounds(true);
    }
}

// Makes the tab's view; it shows once the app places it. Opening one that exists loads the address.
#[tauri::command]
pub fn native_browser_open(app: AppHandle, id: String, url: Option<String>) -> Result<(), String> {
    MainThreadMarker::new().ok_or(OFF_MAIN)?;
    if !valid_id(&id) {
        return Err("Invalid native page id.".into());
    }
    let url = url.map(|u| web_url(&u).ok_or(REFUSED)).transpose()?;
    if VIEWS.with(|views| views.try_borrow().is_ok_and(|v| v.contains_key(&id))) {
        return match url {
            Some(url) => with_view(&id, |view| view.web.load_url(url.as_str()).map_err(text)),
            None => Ok(()),
        };
    }
    let view = build(&app, &id, url.as_ref().map(Url::as_str), None)?;
    if let Some(url) = &url {
        *view.watch.ivars().asked.borrow_mut() = url.to_string();
    }
    keep(id, view)
}

#[tauri::command]
pub fn native_browser_navigate(id: String, action: String, url: Option<String>, zoom: Option<f64>) -> Result<(), String> {
    with_view(&id, |view| {
        let page = view.web.webview();
        match action.as_str() {
            "load" => {
                let url = web_url(url.as_deref().unwrap_or_default()).ok_or(REFUSED)?;
                *view.watch.ivars().asked.borrow_mut() = url.to_string();
                view.web.load_url(url.as_str()).map_err(text)?;
            }
            "back" => drop(unsafe { page.goBack() }),
            "forward" => drop(unsafe { page.goForward() }),
            "reload" => {
                let asked = view.watch.ivars().asked.borrow().clone();
                // After a failed load the page shown is the one before it: ask for the failed one again.
                let failed = view.watch.ivars().failed.borrow().is_some();
                if (failed || unsafe { page.URL() }.is_none()) && !asked.is_empty() {
                    view.web.load_url(&asked).map_err(text)?;
                } else {
                    view.web.reload().map_err(text)?;
                }
            }
            "stop" => unsafe { page.stopLoading() },
            "zoom" => unsafe { page.setPageZoom(zoom.unwrap_or(1.0).clamp(0.5, 3.0)) },
            _ => return Err(format!("Unknown action {action}.")),
        }
        Ok(())
    })
}

// Shows one page over the rect, and hides the rest: only the tab in view is drawn.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn native_browser_show(id: String, x: f64, y: f64, w: f64, h: f64, width: f64, radius: f64) -> Result<(), String> {
    MainThreadMarker::new().ok_or(OFF_MAIN)?;
    VIEWS.with(|views| {
        let views = views.try_borrow().map_err(|_| "The native page is busy.")?;
        let view = views.get(&id).ok_or("No native page is open.")?;
        place(&view.web.webview(), x, y, w, h, width, radius);
        view.web.set_visible(true).map_err(text)
    })
}

#[tauri::command]
pub fn native_browser_hide(app: AppHandle, id: String) -> Result<(), String> {
    with_view(&id, |view| {
        give_back_keys(&app, view);
        view.web.set_visible(false).map_err(text)
    })
}

// Gives the page the keyboard, as Safari does when a page opens or its tab is chosen.
#[tauri::command]
pub fn native_browser_focus(id: String) -> Result<(), String> {
    with_view(&id, |view| view.web.focus().map_err(text))
}

// Closing a page that is already gone is fine: unmounting races window teardown.
#[tauri::command]
pub fn native_browser_close(app: AppHandle, id: String) -> Result<(), String> {
    MainThreadMarker::new().ok_or(OFF_MAIN)?;
    let view = VIEWS.with(|views| views.try_borrow_mut().ok().and_then(|mut v| v.remove(&id)));
    if let Some(view) = view {
        give_back_keys(&app, &view);
        let page = view.web.webview();
        unsafe {
            for key in WATCHED {
                page.removeObserver_forKeyPath(&view.watch, &NSString::from_str(key));
            }
            page.setNavigationDelegate(Some(&view.watch.ivars().wry));
        }
    }
    Ok(())
}

// wry's and WebKit's callbacks are Fn, and a oneshot sender is used once.
fn once<T: Send + 'static>(tx: oneshot::Sender<T>) -> impl Fn(T) + Send + Sync + 'static {
    let tx = Mutex::new(Some(tx));
    move |value| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(value);
        }
    }
}

fn jpeg(image: &NSImage) -> Option<Vec<u8>> {
    let cg = unsafe { image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) }?;
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
    let quality = NSNumber::numberWithDouble(0.85);
    let options = NSDictionary::from_slices(&[unsafe { NSImageCompressionFactor }], &[&*quality as &AnyObject]);
    unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &options) }.map(|d| d.to_vec())
}

type Shot = Result<Vec<u8>, String>;

// WebKit's own picture of the page as a JPEG data URL, at width points across when given. keys:
// the keyboard comes back to the app first, for something the app opens over the page.
async fn picture(app: AppHandle, id: String, keys: bool, width: Option<f64>) -> Result<String, String> {
    let (tx, rx) = oneshot::channel::<Shot>();
    let done = Arc::new(once(tx));
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let taken = done.clone();
        let started = with_view(&id, |view| {
            if keys {
                give_back_keys(&handle, view);
            }
            let block = RcBlock::new(move |image: *mut NSImage, _: *mut NSError| {
                taken(unsafe { image.as_ref() }.and_then(jpeg).ok_or_else(|| "WebKit could not take a picture of the page.".to_string()))
            });
            let config = width.map(|w| {
                let c = unsafe { WKSnapshotConfiguration::new(MainThreadMarker::new().expect("main thread")) };
                unsafe { c.setSnapshotWidth(Some(&NSNumber::numberWithDouble(w))) };
                c
            });
            unsafe { view.web.webview().takeSnapshotWithConfiguration_completionHandler(config.as_deref(), &block) };
            Ok(())
        });
        if let Err(e) = started {
            done(Err(e));
        }
    })
    .map_err(text)?;
    let picture = tokio::time::timeout(Duration::from_secs(3), rx).await.map_err(|_| "The page did not answer.".to_string())?.map_err(text)??;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(picture)))
}

// For something the app opens over the page: its picture stands in while the view is hidden.
#[tauri::command]
pub async fn native_browser_freeze(app: AppHandle, id: String) -> Result<String, String> {
    picture(app, id, true, None).await
}

// A picture for Claude (screenshot_tab), small enough to read well.
#[tauri::command]
pub async fn native_browser_shot(app: AppHandle, id: String) -> Result<String, String> {
    picture(app, id, false, Some(1024.0)).await
}

// Runs the app's page script (lib/page-tools.ts) in WebKit's client world: it shares the page's
// DOM but not its scripts, so a page can't change what the script sees or does. Gives its JSON.
#[tauri::command]
pub async fn native_browser_eval(app: AppHandle, id: String, script: String) -> Result<String, String> {
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let done = Arc::new(once(tx));
    app.run_on_main_thread(move || {
        let answered = done.clone();
        let started = with_view(&id, |view| {
            let mtm = MainThreadMarker::new().ok_or(OFF_MAIN)?;
            let block = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let value = unsafe { value.as_ref() }.and_then(|v| v.downcast_ref::<NSString>()).map(|s| s.to_string());
                let error = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());
                answered(value.ok_or_else(|| error.unwrap_or_else(|| "The page gave no answer.".into())));
            });
            let world = unsafe { WKContentWorld::defaultClientWorld(mtm) };
            unsafe { view.web.webview().evaluateJavaScript_inFrame_inContentWorld_completionHandler(&NSString::from_str(&script), None, &world, Some(&block)) };
            Ok(())
        });
        if let Err(e) = started {
            done(Err(e));
        }
    })
    .map_err(text)?;
    tokio::time::timeout(Duration::from_secs(10), rx).await.map_err(|_| "The page did not answer.".to_string())?.map_err(text)?
}

// A soft blue edge on the page while Claude works in it.
#[tauri::command]
pub fn native_browser_edge(id: String, on: bool) -> Result<(), String> {
    with_view(&id, |view| {
        let page = view.web.webview();
        page.setWantsLayer(true);
        if let Some(layer) = page.layer() {
            layer.setBorderWidth(if on { 2.0 } else { 0.0 });
            layer.setBorderColor(Some(&NSColor::systemBlueColor().colorWithAlphaComponent(0.7).CGColor()));
        }
        Ok(())
    })
}

// A link on the clipboard, for the command bar. macOS asks the person before an app reads the
// clipboard on its own, so unless they always allow it, only say a link is there (empty text).
#[tauri::command]
pub async fn native_browser_copied_link(app: AppHandle, read: bool) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<String>>();
    let done = Arc::new(once(tx));
    app.run_on_main_thread(move || {
        let board = NSPasteboard::generalPasteboard();
        let link = || unsafe { board.stringForType(NSPasteboardTypeString) }.map(|s| s.to_string()).filter(|s| web_url(s.trim()).is_some());
        let asks = board.respondsToSelector(sel!(accessBehavior));
        let behavior = if asks { board.accessBehavior() } else { NSPasteboardAccessBehavior::AlwaysAllow };
        if read || behavior == NSPasteboardAccessBehavior::AlwaysAllow {
            return done(link().map(|s| s.trim().to_string()));
        }
        if behavior == NSPasteboardAccessBehavior::AlwaysDeny {
            return done(None);
        }
        let found = done.clone();
        let block = RcBlock::new(move |patterns: *mut NSSet<NSString>, _: *mut NSError| {
            let web = unsafe { patterns.as_ref() }.is_some_and(|p| p.containsObject(unsafe { NSPasteboardDetectionPatternProbableWebURL }));
            found(web.then(String::new));
        });
        board.detectPatternsForPatterns_completionHandler(&NSSet::from_slice(&[unsafe { NSPasteboardDetectionPatternProbableWebURL }]), &block);
    })
    .map_err(text)?;
    Ok(tokio::time::timeout(Duration::from_secs(2), rx).await.ok().and_then(Result::ok).flatten())
}

// ⌃⌥B from any app brings the window forward; the page then opens the browser and its command
// bar, or, when it was already in front there, puts the app away.
pub fn bring(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else { return };
    let front = main.is_focused().unwrap_or(false) && main.is_visible().unwrap_or(false);
    if !front {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit_to("main", "ll:browser-key", front);
}

// ⌃⌥B's second press: macOS brings back the app that was in front.
#[tauri::command]
pub fn native_browser_away(app: AppHandle) -> Result<(), String> {
    app.hide().map_err(text)
}

#[cfg(test)]
mod tests {
    use super::{may_navigate, web_url};

    // The Rust side refuses what the address field refuses, for links and redirects too.
    #[test]
    fn refuses_what_is_not_a_web_page() {
        assert!(web_url("https://en.wikipedia.org/wiki/Safari").is_some());
        for url in ["javascript:alert(1)", "data:text/html,hi", "file:///etc/hosts", "https://me:pw@example.com/", "https://me@example.com/"] {
            assert!(web_url(url).is_none() && !may_navigate(url), "{url}");
        }
        assert!(may_navigate("about:blank") && may_navigate("about:srcdoc"));
    }
}
