use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::Aborted;
use reqwest::Url;
use serde_json::json;

use super::decode::decode;
use super::fetch::Page;
use super::service::{settle, Dispatch, Reservation, REVOKED_PER_PAGE};
use super::test_server::{
    attempt, cancel_args, fetch_args, html, loopback_capture, test_limits, until, wait_closed,
    wait_for_flag, write_raw, Server, Table,
};
use super::wire::{
    AttemptId, CancelArgs, CancelReply, ContentType, EncodingSource, FailureReason, FetchArgs,
    FetchReply,
};
use super::WebCapture;

const FIRST: &str = "00000000-0000-4000-8000-000000000001";
const LETTERED: &str = "abcdef00-0000-4000-8000-0000000000ab";

fn capture() -> Arc<WebCapture> {
    let table = Arc::new(Table::new().with("capture.test", &["127.0.0.1"]));
    Arc::new(loopback_capture(&table, test_limits()))
}

fn spawn_fetch(
    capture: &Arc<WebCapture>,
    owner: &'static str,
    args: FetchArgs,
) -> tokio::task::JoinHandle<FetchReply> {
    let capture = Arc::clone(capture);
    tokio::spawn(async move { capture.fetch(owner, args).await })
}

async fn reply_of(task: tokio::task::JoinHandle<FetchReply>) -> FetchReply {
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("the fetch replied promptly")
        .expect("the fetch task ran")
}

fn is_set(flag: &AtomicBool) -> bool {
    flag.load(Ordering::SeqCst)
}

/// A server whose `/hold` answers only once `release` is set, counting arrivals.
fn holding_server(arrived: &Arc<AtomicUsize>, release: &Arc<AtomicBool>) -> Server {
    let (arrived, release) = (Arc::clone(arrived), Arc::clone(release));
    Server::http(move |_, stream| {
        arrived.fetch_add(1, Ordering::SeqCst);
        if wait_for_flag(&release) {
            html(stream, "<p>held</p>");
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_mid_body_replies_cancelled_and_closes_the_connection() {
    let (first_sent, closed) = (
        Arc::new(AtomicBool::new(false)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = Server::http({
        let (first_sent, closed) = (Arc::clone(&first_sent), Arc::clone(&closed));
        move |_, stream| {
            write_raw(
                stream,
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 60000\r\n\r\n<p>",
            );
            write_raw(stream, &[b'a'; 1000]);
            first_sent.store(true, Ordering::SeqCst);
            if wait_closed(stream, Duration::from_secs(5)) {
                closed.store(true, Ordering::SeqCst);
            }
        }
    });
    let capture = capture();
    let task = spawn_fetch(
        &capture,
        "main",
        fetch_args(1, &server.url("capture.test", "/")),
    );
    until("the first body bytes", || is_set(&first_sent)).await;

    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(
        reply_of(task).await,
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    until("the connection to close", || is_set(&closed)).await;
    assert_eq!(capture.active_windows(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancel_must_match_both_the_window_and_the_attempt() {
    let (arrived, release) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = holding_server(&arrived, &release);
    let capture = capture();
    let task = spawn_fetch(
        &capture,
        "main",
        fetch_args(1, &server.url("capture.test", "/hold")),
    );
    until("the request", || arrived.load(Ordering::SeqCst) == 1).await;

    assert_eq!(
        capture.cancel("other-window", &cancel_args(1)),
        CancelReply::NotActive {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(
        capture.cancel("main", &cancel_args(2)),
        CancelReply::NotActive {
            attempt_id: attempt(2)
        }
    );
    release.store(true, Ordering::SeqCst);

    match reply_of(task).await {
        FetchReply::Fetched {
            attempt_id, html, ..
        } => {
            assert_eq!((attempt_id, html.as_str()), (attempt(1), "<p>held</p>"));
        }
        other => panic!("expected the page, got {other:?}"),
    }
    // Finished attempts cannot be cancelled, and leave nothing behind.
    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::NotActive {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(capture.active_windows(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_newer_fetch_supersedes_the_window_and_closes_the_older_one() {
    let (slow_arrived, slow_closed) = (
        Arc::new(AtomicBool::new(false)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = Server::http({
        let (slow_arrived, slow_closed) = (Arc::clone(&slow_arrived), Arc::clone(&slow_closed));
        move |request, stream| {
            if request.target == "/slow" {
                slow_arrived.store(true, Ordering::SeqCst);
                if wait_closed(stream, Duration::from_secs(5)) {
                    slow_closed.store(true, Ordering::SeqCst);
                }
            } else {
                html(stream, "<p>fast</p>");
            }
        }
    });
    let capture = capture();
    let older = spawn_fetch(
        &capture,
        "main",
        fetch_args(1, &server.url("capture.test", "/slow")),
    );
    until("the older request", || is_set(&slow_arrived)).await;

    let newer = capture
        .fetch("main", fetch_args(2, &server.url("capture.test", "/fast")))
        .await;

    match newer {
        FetchReply::Fetched {
            attempt_id, html, ..
        } => {
            assert_eq!((attempt_id, html.as_str()), (attempt(2), "<p>fast</p>"));
        }
        other => panic!("expected the newer page, got {other:?}"),
    }
    assert_eq!(
        reply_of(older).await,
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    until("the older connection to close", || is_set(&slow_closed)).await;
    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::NotActive {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(capture.active_windows(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn windows_hold_their_own_attempts_even_with_the_same_id() {
    let (arrived, release) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = holding_server(&arrived, &release);
    let capture = capture();
    let url = server.url("capture.test", "/hold");
    let left = spawn_fetch(&capture, "left", fetch_args(1, &url));
    let right = spawn_fetch(&capture, "right", fetch_args(1, &url));
    until("both requests", || arrived.load(Ordering::SeqCst) == 2).await;
    assert_eq!(capture.active_windows(), 2);

    assert_eq!(
        capture.cancel("left", &cancel_args(1)),
        CancelReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    release.store(true, Ordering::SeqCst);

    assert_eq!(
        reply_of(left).await,
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    assert!(matches!(reply_of(right).await, FetchReply::Fetched { .. }));
    assert_eq!(capture.active_windows(), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forgetting_a_window_cancels_its_attempt() {
    let (arrived, release) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = holding_server(&arrived, &release);
    let capture = capture();
    let task = spawn_fetch(
        &capture,
        "main",
        fetch_args(1, &server.url("capture.test", "/hold")),
    );
    until("the request", || arrived.load(Ordering::SeqCst) == 1).await;

    capture.forget_owner("absent-window");
    assert_eq!(capture.active_windows(), 1);
    capture.forget_owner("main");

    assert_eq!(
        reply_of(task).await,
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(capture.active_windows(), 0);
    release.store(true, Ordering::SeqCst);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_dropped_fetch_frees_its_window() {
    let (arrived, release) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let server = holding_server(&arrived, &release);
    let capture = capture();
    let task = spawn_fetch(
        &capture,
        "main",
        fetch_args(1, &server.url("capture.test", "/hold")),
    );
    until("the request", || arrived.load(Ordering::SeqCst) == 1).await;
    assert_eq!(capture.active_windows(), 1);

    task.abort();
    assert!(task.await.expect_err("aborted").is_cancelled());

    assert_eq!(capture.active_windows(), 0);
    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::NotActive {
            attempt_id: attempt(1)
        }
    );
    release.store(true, Ordering::SeqCst);
}

// --- Before the first poll, and dispatches that arrive late --------------------------------------
//
// A fetch is reserved while Tauri dispatches it, and the reservation moves into that request's own
// task, which runs only when first polled. These hold that task unpolled, or dispatch again the
// way the bridge re-sends a message after a failed reply, and count every lookup at the resolver
// and every connection at the server.

/// A capture with a counting resolver and a loopback server that answers each page with its path.
fn counted() -> (Arc<WebCapture>, Arc<Table>, Server) {
    let server =
        Server::http(|request, stream| html(stream, &format!("<p>{}</p>", request.target)));
    let table = Arc::new(Table::new().with("capture.test", &["127.0.0.1"]));
    let capture = Arc::new(loopback_capture(&table, test_limits()));
    (capture, table, server)
}

/// Attempt ids beyond the 255 that `attempt` names.
fn id(number: u32) -> AttemptId {
    AttemptId::try_from(format!("00000000-0000-4000-8000-{number:012x}")).expect("a canonical UUID")
}

fn page(number: u32, path: &str, server: &Server) -> FetchArgs {
    FetchArgs {
        attempt_id: id(number),
        url: server.url("capture.test", path),
    }
}

fn stop(number: u32) -> CancelArgs {
    CancelArgs {
        attempt_id: id(number),
    }
}

fn cancelled(number: u32) -> FetchReply {
    FetchReply::Cancelled {
        attempt_id: id(number),
    }
}

fn not_active(number: u32) -> CancelReply {
    CancelReply::NotActive {
        attempt_id: id(number),
    }
}

async fn answer(dispatch: Dispatch) -> FetchReply {
    dispatch.reply().await.expect("the window is not sealed")
}

/// The attempt and page of a fetched reply.
fn page_of(reply: FetchReply) -> (AttemptId, String) {
    match reply {
        FetchReply::Fetched {
            attempt_id, html, ..
        } => (attempt_id, html),
        other => panic!("expected a page, got {other:?}"),
    }
}

fn fetched(number: u32, path: &str) -> (AttemptId, String) {
    (id(number), format!("<p>{path}</p>"))
}

fn targets(server: &Server) -> Vec<String> {
    server
        .requests()
        .into_iter()
        .map(|request| request.target)
        .collect()
}

#[tokio::test]
async fn a_cancel_before_the_queued_task_first_runs_stops_it_before_any_lookup() {
    let (capture, table, server) = counted();
    // Spawned like Tauri's command task; this single-threaded runtime polls it only once we await.
    let task = tokio::spawn(capture.reserve("main", page(1, "/a", &server)).reply());
    assert_eq!(
        capture.cancel("main", &stop(1)),
        CancelReply::Cancelled { attempt_id: id(1) }
    );
    assert_eq!(task.await.expect("the task ran"), Ok(cancelled(1)));
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(capture.active_windows(), 0);

    // The next request the person starts runs normally.
    let reply = answer(capture.reserve("main", page(2, "/b", &server))).await;
    assert_eq!(page_of(reply), fetched(2, "/b"));
    assert_eq!((table.asked().len(), server.connections()), (1, 1));
}

#[tokio::test]
async fn a_fetch_dispatched_after_its_cancel_was_answered_never_runs() {
    let (capture, table, server) = counted();
    // The cancel reaches native first and finds nothing; then the fetch it stopped is dispatched.
    assert_eq!(capture.cancel("main", &stop(1)), not_active(1));
    let late = tokio::spawn(capture.reserve("main", page(1, "/a", &server)).reply());

    assert_eq!(late.await.expect("the task ran"), Ok(cancelled(1)));
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(capture.active_windows(), 0);

    let reply = answer(capture.reserve("main", page(2, "/b", &server))).await;
    assert_eq!(page_of(reply), fetched(2, "/b"));
    assert_eq!((table.asked().len(), server.connections()), (1, 1));
}

#[tokio::test]
async fn a_fetch_sent_again_after_its_cancel_neither_restarts_nor_displaces_the_next() {
    let (capture, table, server) = counted();
    let first = capture.reserve("main", page(1, "/a", &server));
    assert_eq!(
        capture.cancel("main", &stop(1)),
        CancelReply::Cancelled { attempt_id: id(1) }
    );
    // The person fetches again; then the bridge re-sends the stopped request's same message.
    let next = capture.reserve("main", page(2, "/b", &server));
    let again = capture.reserve("main", page(1, "/a", &server));
    assert!(matches!(again, Dispatch::Revoked(_)));

    assert_eq!(answer(again).await, cancelled(1));
    assert_eq!(answer(first).await, cancelled(1));
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(page_of(answer(next).await), fetched(2, "/b"));
    assert_eq!(targets(&server), ["/b"]);
    assert_eq!(table.asked().len(), 1);
}

#[tokio::test]
async fn a_late_task_for_a_repeated_id_never_takes_the_newer_dispatch() {
    let (capture, table, server) = counted();
    let a = capture.reserve("main", page(1, "/a", &server));
    let b = capture.reserve("main", page(1, "/b", &server));

    // A's task is first polled after B was dispatched: it has only its own, replaced ticket.
    assert_eq!(answer(a).await, cancelled(1));
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(page_of(answer(b).await), fetched(1, "/b"));
    assert_eq!(targets(&server), ["/b"]);
    assert_eq!((table.asked().len(), server.connections()), (1, 1));
    assert_eq!(capture.remembered_windows(), 0);
}

#[tokio::test]
async fn a_page_load_before_the_fetch_first_runs_stops_it_and_the_reloaded_page_fetches() {
    let (capture, table, server) = counted();
    let old_page = capture.reserve("main", page(1, "/old", &server));
    capture.forget_owner("main");
    // The reloaded page has the same window label, and here even the same attempt id.
    let new_page = capture.reserve("main", page(1, "/new", &server));

    assert_eq!(answer(old_page).await, cancelled(1));
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(page_of(answer(new_page).await), fetched(1, "/new"));
    assert_eq!(targets(&server), ["/new"]);
    assert_eq!(capture.remembered_windows(), 0);
}

#[tokio::test]
async fn another_window_never_stops_a_queued_fetch_and_a_closed_window_never_starts_one() {
    let (capture, table, server) = counted();
    let left = capture.reserve("left", page(1, "/left", &server));
    assert_eq!(capture.cancel("right", &stop(1)), not_active(1));
    capture.forget_owner("right");
    assert_eq!(capture.revoked_in("left"), 0);
    assert_eq!(page_of(answer(left).await), fetched(1, "/left"));
    assert_eq!(table.asked().len(), 1);

    // A window closed while its fetch was queued never starts it, and a new window that reuses
    // its label fetches with its own reservation.
    let closed = capture.reserve("right", page(2, "/closed", &server));
    capture.forget_owner("right");
    let reopened = capture.reserve("right", page(3, "/reopened", &server));
    assert_eq!(answer(closed).await, cancelled(2));
    assert_eq!(page_of(answer(reopened).await), fetched(3, "/reopened"));
    assert_eq!(targets(&server), ["/left", "/reopened"]);
    assert_eq!(table.asked().len(), 2);
    assert_eq!(capture.active_windows(), 0);
}

#[tokio::test]
async fn a_newer_request_replaces_an_unpolled_one_whose_id_stays_stopped() {
    let (capture, table, server) = counted();
    let older = capture.reserve("main", page(1, "/older", &server));
    let newer = capture.reserve("main", page(2, "/newer", &server));
    // The older request dispatched again neither runs nor displaces the newer one.
    let again = capture.reserve("main", page(1, "/older", &server));

    assert_eq!(answer(older).await, cancelled(1));
    assert_eq!(answer(again).await, cancelled(1));
    assert!(table.asked().is_empty());
    assert_eq!(page_of(answer(newer).await), fetched(2, "/newer"));
    assert_eq!(targets(&server), ["/newer"]);
    assert_eq!(capture.cancel("main", &stop(1)), not_active(1));
    assert_eq!(capture.revoked_in("main"), 1);
}

#[tokio::test]
async fn a_full_record_seals_the_window_rather_than_forgetting_a_stopped_id() {
    let (capture, table, server) = counted();
    let limit = u32::try_from(REVOKED_PER_PAGE).expect("a small limit");
    for number in 1..=limit {
        assert_eq!(capture.cancel("main", &stop(number)), not_active(number));
    }
    assert_eq!(capture.revoked_in("main"), REVOKED_PER_PAGE);

    // Full: a fresh fetch is refused, and the oldest stopped id is still remembered.
    let fresh = capture.reserve("main", page(limit + 1, "/fresh", &server));
    assert!(matches!(fresh, Dispatch::Sealed));
    assert!(fresh.reply().await.is_err());
    assert_eq!(
        answer(capture.reserve("main", page(1, "/first", &server))).await,
        cancelled(1)
    );
    assert_eq!(
        capture.cancel("main", &stop(limit + 2)),
        not_active(limit + 2)
    );
    assert_eq!(capture.revoked_in("main"), REVOKED_PER_PAGE);
    assert!(table.asked().is_empty());
    assert_eq!(server.connections(), 0);
    assert_eq!(capture.active_windows(), 0);

    // An attempt admitted before the record filled keeps running when its replacement fills it.
    for number in 1..limit {
        capture.cancel("busy", &stop(number));
    }
    let replaced = capture.reserve("busy", page(limit, "/replaced", &server));
    let last = capture.reserve("busy", page(limit + 1, "/last", &server));
    assert_eq!(capture.revoked_in("busy"), REVOKED_PER_PAGE);
    assert!(matches!(
        capture.reserve("busy", page(limit + 2, "/sealed", &server)),
        Dispatch::Sealed
    ));
    assert_eq!(answer(replaced).await, cancelled(limit));
    assert_eq!(page_of(answer(last).await), fetched(limit + 1, "/last"));

    // Other windows are unaffected, and a window's next page starts with an empty record.
    let other = answer(capture.reserve("other", page(1, "/other", &server))).await;
    assert_eq!(page_of(other), fetched(1, "/other"));
    capture.forget_owner("main");
    capture.forget_owner("busy");
    let reloaded = answer(capture.reserve("main", page(limit + 1, "/reloaded", &server))).await;
    assert_eq!(page_of(reloaded), fetched(limit + 1, "/reloaded"));
    assert_eq!(targets(&server), ["/last", "/other", "/reloaded"]);
    assert_eq!(capture.remembered_windows(), 0);
}

#[test]
fn a_dropped_task_frees_only_its_own_reservation_and_memory_stays_bounded() {
    let capture = capture();
    let url = "https://example.invalid/";
    drop(capture.reserve("main", fetch_args(1, url)));
    assert_eq!(capture.remembered_windows(), 0);

    // A stale task for a repeated id is dropped; the newer dispatch keeps the window.
    let stale = capture.reserve("main", fetch_args(1, url));
    let current = capture.reserve("main", fetch_args(1, url));
    drop(stale);
    assert_eq!(capture.active_windows(), 1);
    drop(current);
    assert_eq!(capture.remembered_windows(), 0);

    // Fifty windows, each with a queued fetch and a stopped id, are each one entry, all gone with
    // their pages.
    let windows: Vec<String> = (0..50).map(|window| format!("window-{window}")).collect();
    let queued: Vec<Dispatch> = windows
        .iter()
        .map(|window| capture.reserve(window, fetch_args(2, url)))
        .collect();
    for window in &windows {
        assert_eq!(
            capture.cancel(window, &cancel_args(3)),
            CancelReply::NotActive {
                attempt_id: attempt(3)
            }
        );
    }
    assert_eq!(
        (capture.active_windows(), capture.remembered_windows()),
        (50, 50)
    );
    for window in &windows {
        capture.forget_owner(window);
    }
    assert_eq!(capture.remembered_windows(), 0);
    // Their tasks, dropped after the windows went, change nothing.
    drop(queued);
    assert_eq!(capture.remembered_windows(), 0);
}

/// A dispatch's reservation, for tests that finish an attempt by hand.
fn reserved(capture: &WebCapture, number: u8) -> Reservation {
    match capture.reserve("main", fetch_args(number, "https://example.invalid/")) {
        Dispatch::Run(reservation) => reservation,
        Dispatch::Revoked(_) | Dispatch::Sealed => panic!("expected a reservation"),
    }
}

fn late_page() -> Page {
    let url = Url::parse("https://example.com/late").expect("a URL");
    Page {
        requested_url: url.clone(),
        final_url: url,
        content_type: ContentType::Html,
        decoded: decode(b"<p>late</p>", None).expect("decodable"),
    }
}

#[test]
fn a_result_that_completes_after_its_cancel_is_never_delivered() {
    let capture = capture();
    let (hold, _registration) = reserved(&capture, 1).into_parts();

    // The cancel wins the lock just before the finished attempt tries to deliver.
    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    let current = hold.finish();

    assert!(!current);
    assert_eq!(
        settle(attempt(1), Ok(Ok(late_page())), current),
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(
        settle(attempt(1), Ok(Err(FailureReason::NotFound)), current),
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
    assert_eq!(capture.active_windows(), 0);
}

#[test]
fn a_superseded_attempt_cannot_take_back_its_window() {
    let capture = capture();
    let (older, older_registration) = reserved(&capture, 1).into_parts();
    let older_watch = older_registration.handle();

    let (newer, _newer_registration) = reserved(&capture, 2).into_parts();
    assert!(older_watch.is_aborted());
    assert_eq!(capture.active_windows(), 1);

    // The older one finishing late neither delivers nor frees the newer one's window.
    assert!(!older.finish());
    assert_eq!(capture.active_windows(), 1);
    assert_eq!(
        capture.cancel("main", &cancel_args(1)),
        CancelReply::NotActive {
            attempt_id: attempt(1)
        }
    );
    assert!(newer.finish());
    assert_eq!(capture.active_windows(), 0);
}

#[test]
fn only_a_current_finished_attempt_is_delivered() {
    match settle(attempt(1), Ok(Ok(late_page())), true) {
        FetchReply::Fetched {
            attempt_id,
            requested_url,
            final_url,
            fetched_at,
            content_type,
            encoding,
            encoding_source,
            html,
            had_replacements,
        } => {
            assert_eq!(attempt_id, attempt(1));
            assert_eq!(requested_url, "https://example.com/late");
            assert_eq!(final_url, "https://example.com/late");
            let at = chrono::DateTime::parse_from_rfc3339(&fetched_at).expect("RFC 3339");
            assert_eq!(at.offset().local_minus_utc(), 0);
            assert!(
                fetched_at.ends_with('Z') && fetched_at.len() == 20,
                "{fetched_at}"
            );
            assert_eq!(
                (
                    content_type,
                    encoding,
                    encoding_source,
                    html.as_str(),
                    had_replacements
                ),
                (
                    ContentType::Html,
                    "UTF-8",
                    EncodingSource::Detected,
                    "<p>late</p>",
                    false
                )
            );
        }
        other => panic!("expected the page, got {other:?}"),
    }
    assert_eq!(
        settle(attempt(1), Ok(Err(FailureReason::NotFound)), true),
        FetchReply::Failed {
            attempt_id: attempt(1),
            reason: FailureReason::NotFound
        }
    );
    assert_eq!(
        settle(attempt(1), Err(Aborted), true),
        FetchReply::Cancelled {
            attempt_id: attempt(1)
        }
    );
}

#[test]
fn arguments_are_read_strictly() {
    let url = "https://example.com/";
    let args: FetchArgs =
        serde_json::from_value(json!({ "attemptId": FIRST, "url": url })).expect("readable");
    assert_eq!((args.attempt_id, args.url.as_str()), (attempt(1), url));
    let cancel: CancelArgs =
        serde_json::from_value(json!({ "attemptId": FIRST })).expect("readable");
    assert_eq!(cancel.attempt_id, attempt(1));
    let lettered: CancelArgs =
        serde_json::from_value(json!({ "attemptId": LETTERED })).expect("readable");
    assert_eq!(String::from(lettered.attempt_id), LETTERED);

    for unreadable in [
        json!({ "attemptId": FIRST }),
        json!({ "url": url }),
        json!({ "attemptId": FIRST, "url": url, "vaultPath": "/notes" }),
        json!({ "attemptId": FIRST, "url": 5 }),
        json!({ "attemptId": LETTERED.to_uppercase(), "url": url }),
        json!({ "attemptId": format!("{{{FIRST}}}"), "url": url }),
        json!({ "attemptId": FIRST.replace('-', ""), "url": url }),
        json!({ "attemptId": "not-an-id", "url": url }),
        json!({ "attemptId": null, "url": url }),
    ] {
        assert!(
            serde_json::from_value::<FetchArgs>(unreadable.clone()).is_err(),
            "{unreadable}"
        );
    }
    for unreadable in [
        json!({}),
        json!({ "attemptId": FIRST, "owner": "main" }),
        json!({ "attemptId": LETTERED.to_uppercase() }),
    ] {
        assert!(
            serde_json::from_value::<CancelArgs>(unreadable.clone()).is_err(),
            "{unreadable}"
        );
    }
}

fn value(reply: &impl serde::Serialize) -> serde_json::Value {
    serde_json::to_value(reply).expect("serializable")
}

#[test]
fn replies_serialize_to_the_frozen_shapes() {
    assert_eq!(
        value(&FetchReply::Fetched {
            attempt_id: attempt(1),
            requested_url: "https://example.com/a".to_string(),
            final_url: "https://example.com/b".to_string(),
            fetched_at: "2026-10-20T14:03:11Z".to_string(),
            content_type: ContentType::Xhtml,
            encoding: "windows-1252",
            encoding_source: EncodingSource::Fallback,
            html: "<p>x</p>".to_string(),
            had_replacements: false,
        }),
        json!({
            "status": "fetched",
            "attemptId": FIRST,
            "requestedUrl": "https://example.com/a",
            "finalUrl": "https://example.com/b",
            "fetchedAt": "2026-10-20T14:03:11Z",
            "contentType": "application/xhtml+xml",
            "encoding": "windows-1252",
            "encodingSource": "fallback",
            "html": "<p>x</p>",
            "hadReplacements": false,
        })
    );
    assert_eq!(
        value(&FetchReply::Failed {
            attempt_id: attempt(1),
            reason: FailureReason::NotPublicAddress
        }),
        json!({ "status": "failed", "attemptId": FIRST, "reason": "notPublicAddress" })
    );
    assert_eq!(
        value(&FetchReply::Cancelled {
            attempt_id: attempt(1)
        }),
        json!({ "status": "cancelled", "attemptId": FIRST })
    );
    assert_eq!(
        value(&CancelReply::Cancelled {
            attempt_id: attempt(1)
        }),
        json!({ "status": "cancelled", "attemptId": FIRST })
    );
    assert_eq!(
        value(&CancelReply::NotActive {
            attempt_id: attempt(1)
        }),
        json!({ "status": "notActive", "attemptId": FIRST })
    );
}

#[test]
fn the_failure_reasons_and_encoding_sources_are_the_frozen_closed_lists() {
    use FailureReason::*;
    // Adding a reason without listing it here stops this from compiling.
    let position = |reason: FailureReason| match reason {
        InvalidUrl => 0,
        UnsupportedScheme => 1,
        CredentialsInUrl => 2,
        NotPublicAddress => 3,
        DnsFailed => 4,
        ConnectFailed => 5,
        TlsFailed => 6,
        TimedOut => 7,
        NetworkError => 8,
        TooManyRedirects => 9,
        InsecureRedirect => 10,
        InvalidRedirect => 11,
        AccessDenied => 12,
        NotFound => 13,
        RateLimited => 14,
        ServerError => 15,
        UnexpectedStatus => 16,
        NotHtml => 17,
        CompressedResponse => 18,
        TooLarge => 19,
        UnsupportedCharset => 20,
    };
    let reasons = [
        InvalidUrl,
        UnsupportedScheme,
        CredentialsInUrl,
        NotPublicAddress,
        DnsFailed,
        ConnectFailed,
        TlsFailed,
        TimedOut,
        NetworkError,
        TooManyRedirects,
        InsecureRedirect,
        InvalidRedirect,
        AccessDenied,
        NotFound,
        RateLimited,
        ServerError,
        UnexpectedStatus,
        NotHtml,
        CompressedResponse,
        TooLarge,
        UnsupportedCharset,
    ];
    assert!(reasons
        .iter()
        .enumerate()
        .all(|(index, reason)| position(*reason) == index));
    let names: Vec<serde_json::Value> = reasons
        .iter()
        .map(|reason| serde_json::to_value(reason).expect("serializable"))
        .collect();
    assert_eq!(
        serde_json::Value::Array(names),
        json!([
            "invalidUrl",
            "unsupportedScheme",
            "credentialsInUrl",
            "notPublicAddress",
            "dnsFailed",
            "connectFailed",
            "tlsFailed",
            "timedOut",
            "networkError",
            "tooManyRedirects",
            "insecureRedirect",
            "invalidRedirect",
            "accessDenied",
            "notFound",
            "rateLimited",
            "serverError",
            "unexpectedStatus",
            "notHtml",
            "compressedResponse",
            "tooLarge",
            "unsupportedCharset",
        ])
    );
    let sources = [
        EncodingSource::Bom,
        EncodingSource::Header,
        EncodingSource::Meta,
        EncodingSource::Detected,
        EncodingSource::Fallback,
    ]
    .map(|source| serde_json::to_value(source).expect("serializable"));
    assert_eq!(
        serde_json::Value::Array(sources.to_vec()),
        json!(["bom", "header", "meta", "detected", "fallback"])
    );
    assert_eq!(
        [ContentType::Html, ContentType::Xhtml]
            .map(|content_type| serde_json::to_value(content_type).expect("serializable")),
        [json!("text/html"), json!("application/xhtml+xml")]
    );
}
