//! Extensions, natively: strict package validation, a local package store with per-vault
//! activation, window-owned sessions and runs, and one guarded write per run: a new page, or the
//! whole reviewed postimage of an existing page with its exact earlier text kept first. A
//! committed write can be undone from its window and session.
//!
//! The frozen contract is `src/leadinglight/extensions/extensionApi.ts`,
//! `src/leadinglight/proposals/proposalContract.ts` and `proposalUndoContract.ts`;
//! `docs/leadinglight/extensions-native.md` and `docs/leadinglight/commentary-native.md` explain
//! lifetimes, limits and what native does not judge (passages and associations).

#[cfg(all(test, unix))]
mod append_tests;
mod create;
mod document;
mod json;
mod manifest;
mod report;
mod runs;
mod store;
pub(crate) mod wire;

#[cfg(all(test, unix))]
mod create_tests;
#[cfg(all(test, unix))]
mod registry_tests;
#[cfg(all(test, unix))]
mod runs_tests;
#[cfg(all(test, unix))]
mod store_tests;
#[cfg(all(test, unix))]
mod undo_tests;
#[cfg(test)]
mod validate_tests;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use crate::leadinglight_history::VaultRoots;

use create::{CreateIo, NativeCreateIo, Vault};
#[cfg(test)]
use manifest::Capability;
pub(crate) use runs::BeginRequest;
use runs::Runs;
use store::Store;
use wire::{
    ActivationReply, CloseSessionReply, DeactivationReply, DocumentHandleReply, EndRunReply,
    FolderHandleReply, GuardedProposal, HandleRefusal, ImportReply, ListReply, OpenSessionReply,
    ProposalReceipt, QueryReply, ReadReply, ReleaseUndoReply, RunAdmission, RunRefusal,
    UndoQueryReply, UndoReceipt, UndoRequest, VaultRefusal,
};

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Only the canonical lowercase form, so one id never names two operations.
pub(crate) fn is_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|uuid| uuid.hyphenated().to_string() == value)
}

/// The contract's opaque token: 1 to 128 of `A-Z a-z 0-9 . _ : -`.
pub(crate) fn is_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn vault_of(roots: &VaultRoots) -> Vault {
    Vault {
        requested: roots.requested.clone(),
        canonical: roots.canonical.clone(),
    }
}

/// Preferences are keyed by the vault's resolved path, so moving a vault folder turns its
/// extensions off rather than guessing.
fn vault_key(roots: &VaultRoots) -> String {
    roots.canonical.to_string_lossy().into_owned()
}

pub(crate) struct Extensions {
    store: Store,
    runs: Runs,
    io: Box<dyn CreateIo>,
    /// One activation change at a time, from its compare-and-set through revoking its runs and
    /// joining their writes, so an older change never revokes the runs of a newer one. The
    /// preference lock is not held while joining, and runs and writes never take this one, so an
    /// admitted write always settles.
    transitions: Mutex<()>,
}

impl Extensions {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self::with_io(root, Box::new(NativeCreateIo))
    }

    pub(crate) fn with_io(root: PathBuf, io: Box<dyn CreateIo>) -> Self {
        Self::from_parts(Store::new(root), io)
    }

    /// A host that also performs the given capabilities, for tests of what they enable.
    #[cfg(test)]
    pub(crate) fn with_host(root: PathBuf, io: Box<dyn CreateIo>, host: Vec<Capability>) -> Self {
        Self::from_parts(
            Store::with_host(root, Box::new(store::NativeStoreIo), host),
            io,
        )
    }

    pub(crate) fn from_parts(store: Store, io: Box<dyn CreateIo>) -> Self {
        Self {
            store,
            runs: Runs::default(),
            io,
            transitions: Mutex::new(()),
        }
    }

    fn transition(&self) -> MutexGuard<'_, ()> {
        self.transitions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn import(&self, package_text: &str) -> ImportReply {
        self.store.import(package_text)
    }

    pub(crate) fn list(&self, roots: Option<&VaultRoots>) -> ListReply {
        match roots {
            Some(roots) => ListReply::Ok {
                extensions: self.store.list(&vault_key(roots)),
            },
            None => ListReply::Refused {
                reason: VaultRefusal::VaultUnavailable,
            },
        }
    }

    pub(crate) fn read(&self, package_sha256: &str) -> ReadReply {
        self.store.read(package_sha256)
    }

    /// Compare-and-set, then the runs of a replaced version are revoked and their writes joined
    /// before the answer. A change whose folder sync failed is still in place, so it is answered
    /// and revoked like any other.
    pub(crate) fn activate(
        &self,
        roots: Option<&VaultRoots>,
        package_id: &str,
        package_sha256: &str,
        expected_active_sha256: Option<&str>,
    ) -> ActivationReply {
        let Some(roots) = roots else {
            return ActivationReply::Refused {
                reason: wire::ActivationRefusal::VaultUnavailable,
                missing_capabilities: Vec::new(),
            };
        };
        let _transition = self.transition();
        match self.store.activate(
            &vault_key(roots),
            package_id,
            package_sha256,
            expected_active_sha256,
        ) {
            Ok(activated) => {
                let revoked_runs = match activated.replaced {
                    Some(_) => {
                        self.runs
                            .revoke_package(&roots.canonical, package_id, Some(package_sha256))
                    }
                    None => 0,
                };
                ActivationReply::Active {
                    package_sha256: package_sha256.to_string(),
                    previous_sha256: activated.previous,
                    revoked_runs,
                }
            }
            Err((reason, missing_capabilities)) => ActivationReply::Refused {
                reason,
                missing_capabilities,
            },
        }
    }

    pub(crate) fn deactivate(
        &self,
        roots: Option<&VaultRoots>,
        package_id: &str,
        expected_active_sha256: &str,
    ) -> DeactivationReply {
        let Some(roots) = roots else {
            return DeactivationReply::Refused {
                reason: wire::DeactivationRefusal::VaultUnavailable,
            };
        };
        let _transition = self.transition();
        match self
            .store
            .deactivate(&vault_key(roots), package_id, expected_active_sha256)
        {
            Ok(()) => DeactivationReply::Inactive {
                revoked_runs: self.runs.revoke_package(&roots.canonical, package_id, None),
            },
            Err(reason) => DeactivationReply::Refused { reason },
        }
    }

    pub(crate) fn open_session(&self, owner: &str, roots: Option<&VaultRoots>) -> OpenSessionReply {
        match roots {
            Some(roots) => self.runs.open_session(owner, vault_of(roots)),
            None => OpenSessionReply::Refused {
                reason: VaultRefusal::VaultUnavailable,
            },
        }
    }

    pub(crate) fn close_session(&self, owner: &str, session_id: &str) -> CloseSessionReply {
        if !is_token(session_id) {
            return CloseSessionReply::Unknown;
        }
        self.runs.close_session(owner, session_id)
    }

    pub(crate) fn begin_run(&self, owner: &str, request: &BeginRequest) -> RunAdmission {
        if !is_token(&request.session_id) {
            return RunAdmission::Refused {
                reason: RunRefusal::SessionClosed,
            };
        }
        if !is_token(&request.invocation_id) || !is_token(&request.command_id) {
            return RunAdmission::Refused {
                reason: RunRefusal::UnknownCommand,
            };
        }
        if !is_sha256_hex(&request.package_sha256) {
            return RunAdmission::Refused {
                reason: RunRefusal::NotActive,
            };
        }
        self.runs.begin(owner, request, |vault| {
            let key = vault.canonical.to_string_lossy().into_owned();
            self.store
                .admit(&key, &request.package_sha256, &request.command_id)
        })
    }

    pub(crate) fn end_run(
        &self,
        owner: &str,
        session_id: &str,
        invocation_id: &str,
    ) -> EndRunReply {
        if !is_token(session_id) || !is_token(invocation_id) {
            return EndRunReply::UnknownSession;
        }
        self.runs.end_run(owner, session_id, invocation_id)
    }

    pub(crate) fn bind_folder(&self, owner: &str, run_id: &str, folder: &str) -> FolderHandleReply {
        if !is_token(run_id) {
            return FolderHandleReply::Refused {
                reason: HandleRefusal::StaleRun,
            };
        }
        self.runs.bind_folder(owner, run_id, folder)
    }

    pub(crate) fn bind_document(
        &self,
        owner: &str,
        run_id: &str,
        path: &str,
    ) -> DocumentHandleReply {
        if !is_token(run_id) {
            return DocumentHandleReply::Refused {
                reason: HandleRefusal::StaleRun,
            };
        }
        self.runs.bind_document(owner, run_id, path)
    }

    pub(crate) fn submit(&self, owner: &str, proposal: &GuardedProposal) -> ProposalReceipt {
        self.runs.submit(owner, proposal, self.io.as_ref())
    }

    pub(crate) fn query(&self, owner: &str, operation_id: &str) -> QueryReply {
        self.runs.query(owner, operation_id)
    }

    pub(crate) fn undo(&self, owner: &str, request: &UndoRequest) -> UndoReceipt {
        self.runs.undo(owner, request, self.io.as_ref())
    }

    pub(crate) fn query_undo(&self, owner: &str, operation_id: &str) -> UndoQueryReply {
        self.runs.query_undo(owner, operation_id)
    }

    pub(crate) fn release_undo(
        &self,
        owner: &str,
        session_id: &str,
        undo_receipt: &str,
    ) -> ReleaseUndoReply {
        if !is_token(session_id) || !is_token(undo_receipt) {
            return ReleaseUndoReply::Unknown;
        }
        self.runs.release_undo(owner, session_id, undo_receipt)
    }

    /// A window closed or began loading a page: its sessions end now, with no reply to lose.
    pub(crate) fn forget_owner(&self, owner: &str) {
        self.runs.forget_owner(owner);
    }
}

/// The app's extension state, created on first use so a missing configuration folder never
/// affects startup, vault opening or saving.
#[derive(Default)]
pub(crate) struct ExtensionsState(OnceLock<Result<Arc<Extensions>, String>>);

impl ExtensionsState {
    pub(crate) fn get(&self) -> Result<Arc<Extensions>, String> {
        self.0
            .get_or_init(|| default_root().map(|root| Arc::new(Extensions::new(root))))
            .clone()
    }

    /// Only if extensions were ever used in this process; nothing is created for this.
    pub(crate) fn forget_owner(&self, owner: &str) {
        if let Some(Ok(extensions)) = self.0.get() {
            extensions.forget_owner(owner);
        }
    }
}

/// `extensions/` beside the app's settings, in the same local configuration namespace.
fn default_root() -> Result<PathBuf, String> {
    let settings = crate::app_config::preferred_app_config_path("settings.json")?;
    settings
        .parent()
        .map(|folder| folder.join("extensions"))
        .ok_or_else(|| "The local configuration folder could not be found".to_string())
}

/// A page load in a window ends that window's sessions, even when its own close reply is lost.
pub(crate) fn on_page_load(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri::Manager;

    if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        webview
            .state::<ExtensionsState>()
            .forget_owner(webview.label());
    }
}

#[cfg(test)]
pub(crate) fn test_roots(path: &std::path::Path) -> VaultRoots {
    VaultRoots {
        requested: path.to_path_buf(),
        canonical: path.canonicalize().unwrap(),
    }
}
