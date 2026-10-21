//! Adapt commands (`ADAPT_COMMANDS` in `src/leadinglight/adapt/adaptContract.ts`). Each takes one
//! `args` object read strictly and runs off the main thread; expected cases answer as data, and
//! `Err` only means the arguments could not be read or the local store could not be located. The
//! calling window's label owns every visit; no command trusts an id alone. There is no generic
//! provider call: these are the only operations the webview can reach.

use tauri::{AppHandle, State, WebviewWindow};

use super::blocking::run_blocking;
use super::vault::VaultBoundary;
use crate::leadinglight_adapt::wire::{
    CancelConnectReply, CancelTurnReply, CloseVisitReply, ConnectArgs, ConnectReply,
    ConversationArgs, DeleteConversationReply, DisconnectReply, ListConversationsReply,
    NewConversationReply, OpenVisitArgs, OpenVisitReply, ProviderArgs, ReadConversationArgs,
    ReadConversationReply, SaveConversationReply, SendArgs, SendReply, StatusArgs, StatusReply,
    TurnArgs, VisitArgs,
};
use crate::leadinglight_adapt::AdaptState;
use crate::leadinglight_history::VaultRoots;

/// A registered vault, resolved now; `None` answers `vaultUnavailable`.
fn vault_roots(vault_path: &str) -> Option<VaultRoots> {
    VaultBoundary::from_request(Some(vault_path))
        .ok()
        .map(|boundary| boundary.roots())
}

/// Never starts a sign-in.
#[tauri::command]
pub async fn adapt_provider_status(
    state: State<'_, AdaptState>,
    args: StatusArgs,
) -> Result<StatusReply, String> {
    let StatusArgs {} = args;
    let host = state.get()?;
    run_blocking(move || host.status()).await
}

/// Only from an explicit Connect: opens the provider's own sign-in page in the system browser.
#[tauri::command]
pub async fn adapt_connect(
    app: AppHandle,
    state: State<'_, AdaptState>,
    args: ConnectArgs,
) -> Result<ConnectReply, String> {
    let host = state.get()?;
    run_blocking(move || {
        use tauri_plugin_opener::OpenerExt;
        let open_browser = |url: &str| app.opener().open_url(url, None::<String>).is_ok();
        host.connect(&args, &open_browser)
    })
    .await?
}

#[tauri::command]
pub async fn adapt_cancel_connect(
    state: State<'_, AdaptState>,
    args: ProviderArgs,
) -> Result<CancelConnectReply, String> {
    let host = state.get()?;
    run_blocking(move || host.cancel_connect(&args)).await
}

#[tauri::command]
pub async fn adapt_disconnect(
    state: State<'_, AdaptState>,
    args: ProviderArgs,
) -> Result<DisconnectReply, String> {
    let host = state.get()?;
    run_blocking(move || host.disconnect(&args)).await
}

#[tauri::command]
pub async fn adapt_open_visit(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: OpenVisitArgs,
) -> Result<OpenVisitReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.open_visit(&owner, vault_roots(&args.vault_path).as_ref())).await
}

#[tauri::command]
pub async fn adapt_close_visit(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: VisitArgs,
) -> Result<CloseVisitReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.close_visit(&owner, &args)).await
}

#[tauri::command]
pub async fn adapt_list_conversations(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: VisitArgs,
) -> Result<ListConversationsReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.list(&owner, &args)).await
}

#[tauri::command]
pub async fn adapt_new_conversation(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: VisitArgs,
) -> Result<NewConversationReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.new_conversation(&owner, &args)).await
}

/// The poll: a bounded snapshot, or `unchanged` when `knownRevision` is current.
#[tauri::command]
pub async fn adapt_read_conversation(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: ReadConversationArgs,
) -> Result<ReadConversationReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.read(&owner, &args)).await
}

/// Writes the conversation as shown to local storage again. Never contacts a provider.
#[tauri::command]
pub async fn adapt_save_conversation(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: ConversationArgs,
) -> Result<SaveConversationReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.save(&owner, &args)).await
}

#[tauri::command]
pub async fn adapt_delete_conversation(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: ConversationArgs,
) -> Result<DeleteConversationReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.delete(&owner, &args)).await
}

/// Sends exactly the request, attachment texts and named earlier turns; answers once admitted.
#[tauri::command]
pub async fn adapt_send(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: SendArgs,
) -> Result<SendReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.send(&owner, &args)).await
}

/// Closes candidate admission for the turn at once, admitted or not.
#[tauri::command]
pub async fn adapt_cancel_turn(
    window: WebviewWindow,
    state: State<'_, AdaptState>,
    args: TurnArgs,
) -> Result<CancelTurnReply, String> {
    let host = state.get()?;
    let owner = window.label().to_string();
    run_blocking(move || host.cancel(&owner, &args)).await
}
