//! AppKit's standard Quit action bypasses Tauri's cancellable ExitRequested event.
//! Extend Tao's existing delegate with the missing asynchronous termination gate.

#[cfg(target_os = "macos")]
mod platform {
    use objc2::encode::Encode;
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
    use std::ffi::CString;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::{App, AppHandle, Manager};

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static WAITING_FOR_SAVE: AtomicBool = AtomicBool::new(false);

    extern "C-unwind" fn application_should_terminate(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &NSApplication,
    ) -> NSApplicationTerminateReply {
        let Some(app) = APP_HANDLE.get() else {
            return NSApplicationTerminateReply::TerminateCancel;
        };
        if app.webview_windows().is_empty() {
            return NSApplicationTerminateReply::TerminateNow;
        }
        log::info!(target: "leadinglight::shutdown", "AppKit quit requested");
        if WAITING_FOR_SAVE.swap(true, Ordering::SeqCst) {
            return NSApplicationTerminateReply::TerminateLater;
        }
        // Start off the AppKit callback stack. Even an immediate emit failure must
        // queue its reply until after this method has returned TerminateLater.
        let app = app.clone();
        if std::thread::Builder::new()
            .name("leadinglight-quit-save".into())
            .spawn(move || crate::shutdown_save::request_appkit_quit(&app))
            .is_err()
        {
            WAITING_FOR_SAVE.store(false, Ordering::SeqCst);
            return NSApplicationTerminateReply::TerminateCancel;
        }
        NSApplicationTerminateReply::TerminateLater
    }

    pub(super) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
        let marker = MainThreadMarker::new().ok_or("Quit gate requires the main thread")?;
        let application = NSApplication::sharedApplication(marker);
        let delegate = application.delegate().ok_or("AppKit delegate is missing")?;
        let delegate_object: &AnyObject = AsRef::<AnyObject>::as_ref(&*delegate);
        let class = delegate_object.class();
        let selector = sel!(applicationShouldTerminate:);
        // Do not silently replace a future upstream implementation. Its lifecycle
        // contract must be reviewed if Tao starts providing this optional method.
        if class.instance_method(selector).is_some() {
            return Err(
                "AppKit delegate already implements the quit gate; review the integration".into(),
            );
        }
        APP_HANDLE
            .set(app.handle().clone())
            .map_err(|_| "Quit gate already installed")?;
        let implementation = application_should_terminate
            as extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> NSApplicationTerminateReply;
        let encoding = CString::new(format!("{}@:@", NSApplicationTerminateReply::ENCODING))?;
        // SAFETY: The method's ABI matches -applicationShouldTerminate: exactly:
        // NSUInteger return, receiver/selector, and one NSApplication object. The
        // runtime copies the encoding; no delegate object or existing method is replaced.
        let installed = unsafe {
            let imp = std::mem::transmute::<
                extern "C-unwind" fn(
                    &AnyObject,
                    Sel,
                    &NSApplication,
                ) -> NSApplicationTerminateReply,
                Imp,
            >(implementation);
            objc2::ffi::class_addMethod(
                class as *const _ as *mut _,
                selector,
                imp,
                encoding.as_ptr(),
            )
        };
        if !installed.as_bool() {
            return Err("Could not install the AppKit quit gate".into());
        }
        // Refresh any optional-selector cache while retaining Tao's same delegate.
        application.setDelegate(Some(&delegate));
        log::info!(target: "leadinglight::shutdown", "AppKit quit gate installed");
        Ok(())
    }

    pub(super) fn reply(app: &AppHandle, saved: bool) -> Result<bool, String> {
        if !WAITING_FOR_SAVE.swap(false, Ordering::SeqCst) {
            return Ok(false);
        }
        app.run_on_main_thread(move || {
            if let Some(marker) = MainThreadMarker::new() {
                log::info!(target: "leadinglight::shutdown", "AppKit quit reply saved={saved}");
                NSApplication::sharedApplication(marker).replyToApplicationShouldTerminate(saved);
            }
        })
        .map_err(|error| {
            WAITING_FOR_SAVE.store(true, Ordering::SeqCst);
            error.to_string()
        })?;
        Ok(true)
    }
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    return platform::setup(app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

pub(crate) fn reply(app: &tauri::AppHandle, saved: bool) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    return platform::reply(app, saved);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, saved);
        Ok(false)
    }
}
