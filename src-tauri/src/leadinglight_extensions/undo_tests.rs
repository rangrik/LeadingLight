//! Undo of committed writes, end to end through `Extensions`, in disposable vaults. Undo outlives
//! the run and the package's activation but not the session; it restores the exact earlier text
//! read back from page history, or moves a created page to Trash, only while the page holds
//! exactly what the write left; and each press is one immutable operation.

use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use super::append_tests::{
    append, appended_world, digest, undo_request, uuid, world, Replace, World, AFTER, BEFORE,
    OBSERVATION, PAGE,
};
use super::test_roots;
use super::wire::{
    CloseSessionReply, CommitKind, DeactivationReply, EndRunReply, FolderHandleReply,
    GuardedProposal, OpenSessionReply, ProposalReceipt, ProposalRefusal, QueryState,
    ReleaseUndoReply, UndoConflict, UndoKind, UndoQueryReply, UndoReceipt, UndoRefusal,
    UndoRequest,
};
use crate::leadinglight_trash::{list_trash, BEFORE_EXACT_MOVE};

fn undone_append(world: &World, operation: &str, durable: bool) -> UndoReceipt {
    UndoReceipt::Undone {
        operation_id: operation.to_string(),
        kind: UndoKind::Append,
        path: world.receipt_path(PAGE),
        restored_sha256: Some(digest(BEFORE)),
        durable: Some(durable),
    }
}

fn refusal(operation: &str, reason: UndoRefusal) -> UndoReceipt {
    UndoReceipt::refused(operation, reason)
}

fn conflict(operation: &str, reason: UndoConflict) -> UndoReceipt {
    UndoReceipt::conflict(operation, reason)
}

/// The kept version of the earlier text, as stored in page history.
fn kept_version_dir(world: &World) -> std::path::PathBuf {
    let versions = world
        .vault
        .canonicalize()
        .unwrap()
        .join(".leadinglight/history/versions");
    for location in fs::read_dir(&versions).unwrap().flatten() {
        for version in fs::read_dir(location.path()).unwrap().flatten() {
            if version.file_type().unwrap().is_dir()
                && fs::read(version.path().join("payload"))
                    .is_ok_and(|bytes| bytes == BEFORE.as_bytes())
            {
                return version.path();
            }
        }
    }
    panic!("no kept version of the earlier text");
}

#[test]
fn undo_restores_the_exact_earlier_bytes_once_after_the_run_and_the_package_are_gone() {
    let (world, ready, proposal, token) = appended_world("main");
    let committed = world.extensions.query("main", &proposal);
    // The run ends and the package is turned off; the note's Undo is core and stays.
    assert_eq!(
        world.extensions.end_run("main", &ready.session, &ready.key),
        EndRunReply::Ended
    );
    let off = world.extensions.deactivate(
        Some(&test_roots(&world.vault)),
        OBSERVATION,
        &world.observation,
    );
    assert!(matches!(off, DeactivationReply::Inactive { .. }), "{off:?}");
    assert_eq!(world.text(PAGE), AFTER);

    let press = uuid();
    let request = undo_request(&press, &ready.session, &token);
    let receipt = world.extensions.undo("main", &request);
    assert_eq!(receipt, undone_append(&world, &press, true));
    assert_eq!(world.text(PAGE), BEFORE);
    world.source_untouched();
    assert_eq!(world.names("Notes"), ["Commentary.md", "Plan.md"]);
    // The text it replaced was kept first, and nothing stays pinned once the token is used.
    let history = world.history(PAGE);
    assert!(history.contains(&digest(AFTER)) && history.contains(&digest(BEFORE)));
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_slots(&ready.session), Some(0));

    // One press is one operation; the token is used up; the write's own answer stands.
    assert_eq!(world.extensions.undo("main", &request), receipt);
    assert_eq!(
        world.extensions.query_undo("main", &press),
        UndoQueryReply::Receipt(receipt.clone())
    );
    let again = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&again, &ready.session, &token)),
        refusal(&again, UndoRefusal::Consumed)
    );
    assert_eq!(world.text(PAGE), BEFORE);
    assert_eq!(world.extensions.query("main", &proposal), committed);
}

#[test]
fn undo_waits_for_the_page_to_hold_exactly_what_was_written() {
    let (world, ready, _, token) = appended_world("main");
    let typed = format!("{AFTER}\nWords typed afterwards.\n");
    fs::write(world.path(PAGE), &typed).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        conflict(&press, UndoConflict::Changed)
    );
    assert_eq!(world.text(PAGE), typed);
    // Back to exactly the written bytes, the same token works again.
    fs::write(world.path(PAGE), AFTER).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        undone_append(&world, &press, true)
    );
    assert_eq!(world.text(PAGE), BEFORE);
}

#[test]
fn undo_never_follows_a_moved_page_or_overwrites_one_that_reused_its_path() {
    for case in [
        "moved away",
        "linked",
        "edited during undo",
        "replaced during undo",
    ] {
        let (world, ready, _, token) = appended_world("main");
        let moved = world.path("Notes/Renamed.md");
        match case {
            "moved away" => fs::rename(world.path(PAGE), &moved).unwrap(),
            "linked" => {
                fs::rename(world.path(PAGE), &moved).unwrap();
                std::os::unix::fs::symlink(&moved, world.path(PAGE)).unwrap();
            }
            "edited during undo" => world.io.after_stage(|page: &Path| {
                fs::write(page, format!("{AFTER}\nTyped while undoing.\n")).unwrap()
            }),
            _ => world.io.after_stage(|page: &Path| {
                let copy = page.with_extension("copy");
                fs::write(&copy, AFTER).unwrap();
                fs::rename(&copy, page).unwrap();
            }),
        }
        let press = uuid();
        let receipt = world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token));
        let expected = if case == "moved away" {
            UndoConflict::Missing
        } else {
            UndoConflict::Changed
        };
        assert_eq!(receipt, conflict(&press, expected), "{case}");
        for page in [world.path(PAGE), moved.clone()] {
            assert_ne!(
                fs::read_to_string(page).ok().as_deref(),
                Some(BEFORE),
                "{case}"
            );
        }
        // Nothing was used up: the earlier text is still pinned for the notice.
        assert_eq!(world.pinned(), 1, "{case}");
        world.source_untouched();
    }
}

#[test]
fn undo_needs_the_same_window_session_token_and_digests() {
    let (world, ready, proposal, token) = appended_world("main");
    let check = |owner: &str, request: &UndoRequest, reason: UndoRefusal| {
        assert_eq!(
            world.extensions.undo(owner, request),
            refusal(&request.operation_id, reason),
            "{request:?}"
        );
    };
    check(
        "other",
        &undo_request(&uuid(), &ready.session, &token),
        UndoRefusal::SessionClosed,
    );
    check(
        "main",
        &undo_request(&uuid(), "session-unknown", &token),
        UndoRefusal::SessionClosed,
    );
    check(
        "main",
        &undo_request(&uuid(), &ready.session, "undo-unknown"),
        UndoRefusal::UnknownReceipt,
    );
    let mut wrong = undo_request(&uuid(), &ready.session, &token);
    wrong.kind = UndoKind::Create;
    check("main", &wrong, UndoRefusal::UnknownReceipt);
    let mut wrong = undo_request(&uuid(), &ready.session, &token);
    wrong.expected_sha256 = digest(BEFORE);
    check("main", &wrong, UndoRefusal::UnknownReceipt);
    let mut wrong = undo_request(&uuid(), &ready.session, &token);
    wrong.before_sha256 = Some(digest(AFTER));
    check("main", &wrong, UndoRefusal::UnknownReceipt);
    let mut wrong = undo_request(&uuid(), &ready.session, &token);
    wrong.before_sha256 = None;
    check("main", &wrong, UndoRefusal::UnknownReceipt);
    // A proposal's id, or one that is not a canonical UUID, never names an Undo.
    check(
        "main",
        &undo_request(&proposal, &ready.session, &token),
        UndoRefusal::OperationMismatch,
    );
    check(
        "main",
        &undo_request("not-a-uuid", &ready.session, &token),
        UndoRefusal::OperationMismatch,
    );
    // An Undo id never names a proposal either.
    let press = uuid();
    let request = undo_request(&press, &ready.session, "undo-unknown");
    check("main", &request, UndoRefusal::UnknownReceipt);
    let next = world.ready_in("main", &ready.session);
    assert_eq!(
        world.submit(
            "main",
            &append(&press, &next, &next.baseline, &format!("{AFTER}\nMore.\n"))
        ),
        ProposalReceipt::refused(&press, ProposalRefusal::OperationMismatch)
    );
    // The same Undo id with other fields is a mismatch, from any window.
    let changed = undo_request(&press, &ready.session, &token);
    check("main", &changed, UndoRefusal::OperationMismatch);
    check("other", &request, UndoRefusal::OperationMismatch);
    assert_eq!(world.text(PAGE), AFTER);
    assert_eq!(world.pinned(), 1);
}

/// A-B-A: leaving the vault ends its Undo; a later visit cannot use the old token.
#[test]
fn a_closed_session_ends_undo_and_a_new_visit_cannot_revive_it() {
    let (world, ready, _, token) = appended_world("main");
    assert_eq!(world.pinned(), 1);
    assert_eq!(
        world.extensions.close_session("main", &ready.session),
        CloseSessionReply::Closed
    );
    assert_eq!(world.pinned(), 0);
    // Page history still has the earlier text, as an ordinary version.
    assert!(world.history(PAGE).contains(&digest(BEFORE)));
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        refusal(&press, UndoRefusal::SessionClosed)
    );
    let later = world.session("main");
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &later, &token)),
        refusal(&press, UndoRefusal::UnknownReceipt)
    );
    assert_eq!(world.text(PAGE), AFTER);
}

#[test]
fn a_removed_or_damaged_kept_version_is_never_restored() {
    let (world, ready, _, token) = appended_world("main");
    let kept = kept_version_dir(&world);
    let payload = kept.join("payload");
    fs::write(&payload, BEFORE.to_uppercase()).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        refusal(&press, UndoRefusal::PreimageUnavailable)
    );
    assert_eq!(world.text(PAGE), AFTER);
    fs::remove_file(&payload).unwrap();
    fs::remove_file(kept.join("version.json")).unwrap();
    fs::remove_dir(&kept).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        refusal(&press, UndoRefusal::PreimageUnavailable)
    );
    assert_eq!(world.text(PAGE), AFTER);
}

#[test]
fn releasing_unpins_and_forgets_without_touching_the_page() {
    let (world, ready, _, token) = appended_world("main");
    assert_eq!(
        world
            .extensions
            .release_undo("other", &ready.session, &token),
        ReleaseUndoReply::Unknown
    );
    assert_eq!(world.pinned(), 1);
    assert_eq!(
        world
            .extensions
            .release_undo("main", &ready.session, &token),
        ReleaseUndoReply::Released
    );
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_slots(&ready.session), Some(0));
    assert_eq!(
        world
            .extensions
            .release_undo("main", &ready.session, &token),
        ReleaseUndoReply::Unknown
    );
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        refusal(&press, UndoRefusal::UnknownReceipt)
    );
    assert_eq!(world.text(PAGE), AFTER);
    assert!(world.history(PAGE).contains(&digest(BEFORE)));
}

/// Astra acceptance 1: a close racing an admitted Undo joins it before answering or unpinning.
#[test]
fn closing_joins_a_running_undo_before_it_answers() {
    let (world, ready, _, token) = appended_world("main");
    let (started, release) = world.io.gate();
    let press = uuid();
    let undo = {
        let extensions = Arc::clone(&world.extensions);
        let request = undo_request(&press, &ready.session, &token);
        thread::spawn(move || extensions.undo("main", &request))
    };
    started.recv().unwrap();
    assert_eq!(
        world.extensions.query_undo("main", &press),
        UndoQueryReply::State(QueryState::Running {
            operation_id: press.clone()
        })
    );
    let (closed_tx, closed) = mpsc::channel();
    let closer = {
        let extensions = Arc::clone(&world.extensions);
        let session = ready.session.clone();
        thread::spawn(move || {
            closed_tx
                .send(extensions.close_session("main", &session))
                .unwrap()
        })
    };
    let (released_tx, released) = mpsc::channel();
    let releaser = {
        let extensions = Arc::clone(&world.extensions);
        let (session, token) = (ready.session.clone(), token.clone());
        thread::spawn(move || {
            released_tx
                .send(extensions.release_undo("main", &session, &token))
                .unwrap()
        })
    };
    assert!(closed.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(released.recv_timeout(Duration::from_millis(50)).is_err());
    // While it runs, the earlier text stays pinned.
    assert!(world.pinned() >= 1);
    release.send(()).unwrap();
    assert_eq!(closed.recv().unwrap(), CloseSessionReply::Closed);
    closer.join().unwrap();
    assert_eq!(released.recv().unwrap(), ReleaseUndoReply::Unknown);
    releaser.join().unwrap();
    assert_eq!(undo.join().unwrap(), undone_append(&world, &press, true));
    assert_eq!(world.text(PAGE), BEFORE);
    assert_eq!(world.pinned(), 0);
    assert_eq!(world.extensions.runs.undo_tokens(&ready.session), 0);
}

/// A lost Undo reply is uncertain and used up: query and the same press answer it again, and a
/// new press never undoes twice.
#[test]
fn a_lost_undo_reply_is_queried_never_repeated() {
    let (world, ready, _, token) = appended_world("main");
    world.io.set(Replace::Lost);
    let press = uuid();
    let request = undo_request(&press, &ready.session, &token);
    let receipt = world.extensions.undo("main", &request);
    assert_eq!(receipt, UndoReceipt::uncertain(&press));
    assert_eq!(world.extensions.undo("main", &request), receipt);
    assert_eq!(
        world.extensions.query_undo("main", &press),
        UndoQueryReply::Receipt(receipt)
    );
    assert_eq!(
        world.extensions.query_undo("other", &press),
        UndoQueryReply::State(QueryState::Unknown {
            operation_id: press.clone()
        })
    );
    let again = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&again, &ready.session, &token)),
        refusal(&again, UndoRefusal::Consumed)
    );
    assert_eq!(world.pinned(), 0);
}

#[test]
fn a_failed_undo_publication_keeps_the_token() {
    let (world, ready, _, token) = appended_world("main");
    world.io.set(Replace::Fail);
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        refusal(&press, UndoRefusal::StorageUnavailable)
    );
    assert_eq!(world.text(PAGE), AFTER);
    assert_eq!(world.pinned(), 1);
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &undo_request(&press, &ready.session, &token)),
        undone_append(&world, &press, true)
    );
}

// --- Undo of a created page --------------------------------------------------------------------------

const CREATED: &str = "# Commentary on Plan\n\n[Source](Plan.md)\n\n> First passage\n";

/// A created commentary beside its source, and the session, receipt and token.
fn created_world() -> (World, String, ProposalReceipt, String) {
    let world = world();
    let session = world.session("main");
    let run = world.run("main", &session, "k1", &world.quick, "quick");
    let FolderHandleReply::Bound { folder_handle, .. } =
        world.extensions.bind_folder("main", &run, "Notes")
    else {
        panic!("the folder binds");
    };
    let operation = uuid();
    let receipt = world.submit(
        "main",
        &GuardedProposal::Create {
            operation_id: operation,
            run_id: run,
            content: CREATED.to_string(),
            content_sha256: digest(CREATED),
            folder_handle,
            file_name: "Commentary on Plan.md".to_string(),
        },
    );
    let token = match &receipt {
        ProposalReceipt::Committed {
            kind: CommitKind::Create,
            undo_receipt: Some(token),
            ..
        } => token.clone(),
        other => panic!("{other:?}"),
    };
    (world, session, receipt, token)
}

fn create_undo(press: &str, session: &str, token: &str) -> UndoRequest {
    UndoRequest {
        operation_id: press.to_string(),
        session_id: session.to_string(),
        undo_receipt: token.to_string(),
        kind: UndoKind::Create,
        expected_sha256: digest(CREATED),
        before_sha256: None,
    }
}

#[test]
fn undoing_a_creation_moves_exactly_that_page_to_trash() {
    let (world, session, receipt, token) = created_world();
    let ProposalReceipt::Committed { path, .. } = &receipt else {
        unreachable!();
    };
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &create_undo(&press, &session, &token)),
        UndoReceipt::Undone {
            operation_id: press.clone(),
            kind: UndoKind::Create,
            path: path.clone(),
            restored_sha256: None,
            durable: None,
        }
    );
    assert!(!world.path("Notes/Commentary on Plan.md").exists());
    world.source_untouched();
    let trash = list_trash(&world.vault).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(
        trash[0].original_path.as_deref(),
        Some("Notes/Commentary on Plan.md")
    );
    let again = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &create_undo(&again, &session, &token)),
        refusal(&again, UndoRefusal::Consumed)
    );
}

#[test]
fn an_edited_creation_stays_where_it_is() {
    let (world, session, _, token) = created_world();
    let page = world.path("Notes/Commentary on Plan.md");
    fs::write(&page, format!("{CREATED}\nMy own words.\n")).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &create_undo(&press, &session, &token)),
        conflict(&press, UndoConflict::Changed)
    );
    assert!(page.exists());
    assert!(list_trash(&world.vault).unwrap().is_empty());
    fs::remove_file(&page).unwrap();
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("main", &create_undo(&press, &session, &token)),
        conflict(&press, UndoConflict::Missing)
    );
}

/// Astra acceptance 3: an edit while the Trash record is prepared stops the final move, and the
/// token stays usable.
#[test]
fn an_edit_during_the_trash_move_keeps_the_page() {
    let (world, session, _, token) = created_world();
    let page = world.path("Notes/Commentary on Plan.md");
    BEFORE_EXACT_MOVE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|page: &Path| {
            fs::write(page, format!("{CREATED}\nTyped just now.\n")).unwrap();
        }));
    });
    let press = uuid();
    let receipt = world
        .extensions
        .undo("main", &create_undo(&press, &session, &token));
    BEFORE_EXACT_MOVE.with(|hook| *hook.borrow_mut() = None);
    assert_eq!(receipt, conflict(&press, UndoConflict::Changed));
    assert!(fs::read_to_string(&page)
        .unwrap()
        .ends_with("Typed just now.\n"));
    assert!(list_trash(&world.vault).unwrap().is_empty());
    fs::write(&page, CREATED).unwrap();
    let press = uuid();
    assert!(matches!(
        world
            .extensions
            .undo("main", &create_undo(&press, &session, &token)),
        UndoReceipt::Undone { .. }
    ));
}

#[test]
fn a_session_opened_elsewhere_learns_nothing() {
    let (world, session, _, token) = created_world();
    let OpenSessionReply::Open { session_id: other } = world
        .extensions
        .open_session("other", Some(&test_roots(&world.vault)))
    else {
        panic!("the session opens");
    };
    let press = uuid();
    assert_eq!(
        world
            .extensions
            .undo("other", &create_undo(&press, &other, &token)),
        refusal(&press, UndoRefusal::UnknownReceipt)
    );
    assert_eq!(
        world.extensions.release_undo("other", &session, &token),
        ReleaseUndoReply::Unknown
    );
    assert!(world.path("Notes/Commentary on Plan.md").exists());
}

/// The request is read strictly: every field present, `beforeSha256` as a digest or `null`.
#[test]
fn an_undo_request_is_read_strictly() {
    use serde_json::json;

    let whole = json!({
        "operationId": uuid(), "sessionId": "session-1", "undoReceipt": "undo-1",
        "kind": "create", "expectedSha256": digest(BEFORE), "beforeSha256": null,
    });
    let read: UndoRequest = serde_json::from_value(whole.clone()).unwrap();
    assert_eq!((read.kind, read.before_sha256), (UndoKind::Create, None));
    let mut missing = whole.clone();
    missing.as_object_mut().unwrap().remove("beforeSha256");
    assert!(serde_json::from_value::<UndoRequest>(missing).is_err());
    let mut extra = whole.clone();
    extra["path"] = json!("/vault/Notes/Commentary.md");
    assert!(serde_json::from_value::<UndoRequest>(extra).is_err());
    let mut kind = whole;
    kind["kind"] = json!("rename");
    assert!(serde_json::from_value::<UndoRequest>(kind).is_err());
    // Replies carry exactly the frozen keys.
    let created = UndoReceipt::Undone {
        operation_id: "op".into(),
        kind: UndoKind::Create,
        path: "/vault/a.md".into(),
        restored_sha256: None,
        durable: None,
    };
    assert_eq!(
        serde_json::to_value(&created).unwrap(),
        json!({ "status": "undone", "operationId": "op", "kind": "create", "path": "/vault/a.md" })
    );
    let appended = UndoReceipt::Undone {
        operation_id: "op".into(),
        kind: UndoKind::Append,
        path: "/vault/a.md".into(),
        restored_sha256: Some(digest(BEFORE)),
        durable: Some(false),
    };
    assert_eq!(
        serde_json::to_value(&appended).unwrap(),
        json!({
            "status": "undone", "operationId": "op", "kind": "append", "path": "/vault/a.md",
            "restoredSha256": digest(BEFORE), "durable": false,
        })
    );
    assert_eq!(
        serde_json::to_value(refusal("op", UndoRefusal::PreimageUnavailable)).unwrap(),
        json!({ "status": "refused", "operationId": "op", "reason": "preimageUnavailable" })
    );
    assert_eq!(
        serde_json::to_value(ReleaseUndoReply::Released).unwrap(),
        json!({ "status": "released" })
    );
}
