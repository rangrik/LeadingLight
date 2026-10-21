//! Website capture commands (`web_capture_fetch` and `web_capture_cancel`): one explicit page fetch
//! for the calling window, and its cancellation. Each takes one `args` object read strictly; every
//! expected outcome answers as data, and `Err` only means the arguments could not be read or the
//! window's record of stopped fetches is full until its page loads again. The calling window's
//! label owns the attempt: no argument names a window, vault, run or package, and nothing here
//! links a fetch to an extension run. `docs/leadinglight/website-native-integration.md` explains
//! the boundary.

use serde::Deserialize;
use tauri::ipc::{Invoke, InvokeBody, InvokeError};
use tauri::{Manager, Runtime, State, WebviewWindow};

use crate::leadinglight_web_capture::wire::{CancelArgs, CancelReply, FetchArgs};
use crate::leadinglight_web_capture::WebCapture;

const FETCH_COMMAND: &str = "web_capture_fetch";

/// Serves `web_capture_fetch` (only from the dialog's explicit Fetch) while Tauri dispatches it,
/// before any task runs, and hands every other invoke back unchanged. Its attempt is reserved
/// here, and the reservation moves into this request's own task on the async runtime, where the
/// lookups, connections and timers live; a newer fetch from the same window cancels this one.
pub fn dispatch_web_capture_fetch<R: Runtime>(invoke: Invoke<R>) -> Option<Invoke<R>> {
    if invoke.message.command() != FETCH_COMMAND {
        return Some(invoke);
    }
    let Invoke {
        message, resolver, ..
    } = invoke;
    let args = match read_fetch_args(message.payload()) {
        Ok(args) => args,
        Err(error) => {
            resolver.reject(error);
            return None;
        }
    };
    // The owner is the window, exactly as for the cancel command's `WebviewWindow` argument.
    let webview = message.webview_ref();
    let Some(window) = webview.get_webview_window(webview.label()) else {
        resolver.reject("current webview is not a WebviewWindow");
        return None;
    };
    let reply = webview
        .state::<WebCapture>()
        .reserve(window.label(), args)
        .reply();
    resolver.respond_async(async move { reply.await.map_err(InvokeError::from) });
    None
}

/// The fetch's arguments, read as Tauri reads a command argument: the JSON body's `args`, strictly.
fn read_fetch_args(payload: &InvokeBody) -> Result<FetchArgs, String> {
    let InvokeBody::Json(body) = payload else {
        return Err(invalid_args("the call used a bytes payload"));
    };
    let args = body
        .get("args")
        .ok_or_else(|| invalid_args("missing required key args"))?;
    FetchArgs::deserialize(args).map_err(invalid_args)
}

fn invalid_args(error: impl std::fmt::Display) -> String {
    format!("invalid args `args` for command `{FETCH_COMMAND}`: {error}")
}

/// Stops this window's attempt when the id matches; anything else answers `notActive`. Either way
/// the id stays stopped on this page, so a fetch with it that is dispatched later does not run.
#[tauri::command]
pub async fn web_capture_cancel(
    window: WebviewWindow,
    state: State<'_, WebCapture>,
    args: CancelArgs,
) -> Result<CancelReply, String> {
    Ok(state.cancel(window.label(), &args))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tauri::ipc::InvokeBody;

    use super::read_fetch_args;
    use crate::leadinglight::is_disabled_command;

    const FIRST: &str = "00000000-0000-4000-8000-000000000001";
    const LETTERED: &str = "abcdef00-0000-4000-8000-0000000000ab";
    const URL: &str = "https://example.com/";

    #[test]
    fn the_website_commands_are_not_denied() {
        assert!(!is_disabled_command("web_capture_fetch"));
        assert!(!is_disabled_command("web_capture_cancel"));
    }

    #[test]
    fn the_fetch_arguments_are_read_from_args_strictly() {
        let args = read_fetch_args(&InvokeBody::Json(
            json!({ "args": { "attemptId": FIRST, "url": URL } }),
        ))
        .expect("readable");
        assert_eq!(
            (String::from(args.attempt_id), args.url.as_str()),
            (FIRST.to_owned(), URL)
        );

        for unreadable in [
            json!({}),
            json!({ "attemptId": FIRST, "url": URL }),
            json!({ "args": null }),
            json!({ "args": { "attemptId": FIRST } }),
            json!({ "args": { "url": URL } }),
            json!({ "args": { "attemptId": FIRST, "url": URL, "owner": "main" } }),
            json!({ "args": { "attemptId": FIRST, "url": 5 } }),
            json!({ "args": { "attemptId": LETTERED.to_uppercase(), "url": URL } }),
            json!({ "args": { "attemptId": FIRST.replace('-', ""), "url": URL } }),
            json!([{ "attemptId": FIRST, "url": URL }]),
        ] {
            let Err(error) = read_fetch_args(&InvokeBody::Json(unreadable.clone())) else {
                panic!("{unreadable} was read");
            };
            assert!(
                error.starts_with("invalid args `args` for command `web_capture_fetch`: "),
                "{error}"
            );
        }
        assert!(read_fetch_args(&InvokeBody::Raw(URL.as_bytes().to_vec())).is_err());
    }
}
