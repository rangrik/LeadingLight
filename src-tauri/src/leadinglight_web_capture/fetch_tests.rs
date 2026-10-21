//! Every test here drives the real reqwest client over real loopback sockets, through the
//! loopback-allowing test policy and a table resolver. `.test` names never resolve in the system
//! resolver, so reaching the server also proves the connection used the checked answer.

use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::test_server::{
    fetch_args, html, loopback_capture, read_client_hello, respond, server_name, test_limits,
    until, wait_closed, write_raw, Answer, Request, Server, Table,
};
use super::wire::{ContentType, EncodingSource, FailureReason, FetchReply};
use super::{AddressPolicy, Limits, WebCapture};

#[derive(Debug)]
struct Fetched {
    requested_url: String,
    final_url: String,
    content_type: ContentType,
    encoding: &'static str,
    encoding_source: EncodingSource,
    html: String,
    had_replacements: bool,
}

fn fetched(reply: FetchReply) -> Fetched {
    match reply {
        FetchReply::Fetched {
            requested_url,
            final_url,
            content_type,
            encoding,
            encoding_source,
            html,
            had_replacements,
            ..
        } => Fetched {
            requested_url,
            final_url,
            content_type,
            encoding,
            encoding_source,
            html,
            had_replacements,
        },
        other => panic!("expected a page, got {other:?}"),
    }
}

fn failure(reply: FetchReply) -> FailureReason {
    match reply {
        FetchReply::Failed { reason, .. } => reason,
        other => panic!("expected a failure, got {other:?}"),
    }
}

async fn fetch(capture: &WebCapture, url: &str) -> FetchReply {
    capture.fetch("main", fetch_args(1, url)).await
}

/// Each name answers the loopback test server.
fn loopback_names(names: &[&str]) -> Arc<Table> {
    Arc::new(
        names
            .iter()
            .fold(Table::new(), |table, name| table.with(name, &["127.0.0.1"])),
    )
}

fn host_port(request: &Request) -> String {
    let host = request.header("host").unwrap_or_default();
    host.rsplit(':').next().unwrap_or_default().to_owned()
}

fn flag() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

fn is_set(flag: &AtomicBool) -> bool {
    flag.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_name_connects_only_to_its_checked_answer_and_keeps_its_host() {
    let server = Server::http(|_, stream| html(stream, "<p>pinned</p>"));
    let table = loopback_names(&["capture.test"]);
    let capture = loopback_capture(&table, test_limits());

    let input = format!("HTTP://Capture.TEST:{}/page?x=1#part", server.port());
    let page = fetched(fetch(&capture, &input).await);

    let expected = server.url("capture.test", "/page?x=1");
    assert_eq!(page.requested_url, expected);
    assert_eq!(page.final_url, expected);
    assert_eq!(page.html, "<p>pinned</p>");
    assert_eq!(
        (
            page.content_type,
            page.encoding,
            page.encoding_source,
            page.had_replacements
        ),
        (ContentType::Html, "UTF-8", EncodingSource::Header, false)
    );
    assert_eq!(table.asked(), [("capture.test".to_string(), server.port())]);
    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].target, "/page?x=1");
    let host = format!("capture.test:{}", server.port());
    assert_eq!(requests[0].header("host"), Some(host.as_str()));
}

#[tokio::test]
async fn requests_carry_exactly_the_fixed_headers() {
    let server = Server::http(|_, stream| html(stream, "<p>headers</p>"));
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());

    fetched(fetch(&capture, &server.url("capture.test", "/")).await);

    let request = &server.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.version.as_str()),
        ("GET", "HTTP/1.1")
    );
    assert_eq!(
        request.header_names(),
        ["accept", "accept-encoding", "host", "user-agent"]
    );
    assert_eq!(
        request.header("accept"),
        Some("text/html,application/xhtml+xml")
    );
    assert_eq!(request.header("accept-encoding"), Some("identity"));
    assert_eq!(
        request.header("user-agent"),
        Some(concat!("LeadingLight/", env!("CARGO_PKG_VERSION")))
    );
}

#[tokio::test]
async fn an_address_literal_is_connected_without_a_lookup() {
    let server = Server::http(|_, stream| html(stream, "<p>literal</p>"));
    let table = Arc::new(Table::new());
    let capture = loopback_capture(&table, test_limits());

    let page = fetched(fetch(&capture, &server.url("127.0.0.1", "/")).await);

    assert_eq!(page.html, "<p>literal</p>");
    assert!(table.asked().is_empty());
    let host = format!("127.0.0.1:{}", server.port());
    assert_eq!(server.requests()[0].header("host"), Some(host.as_str()));
}

#[tokio::test]
async fn any_non_public_answer_refuses_the_name_before_connecting() {
    let server = Server::http(|_, stream| html(stream, "<p>never</p>"));
    // The loopback answer is allowed under the test policy; the other answer is not.
    let table = Arc::new(
        Table::new()
            .with("mixed.test", &["127.0.0.1", "10.0.0.7"])
            .with("mixed-v6.test", &["127.0.0.1", "fd00::7"])
            .with("private.test", &["192.168.1.20"])
            .with("link-local.test", &["169.254.169.254"])
            .with("mapped.test", &["::ffff:10.0.0.7"])
            .with("nat64.test", &["64:ff9b::a00:7"]),
    );
    let capture = loopback_capture(&table, test_limits());

    for name in [
        "mixed.test",
        "mixed-v6.test",
        "private.test",
        "link-local.test",
        "mapped.test",
        "nat64.test",
    ] {
        let reply = fetch(&capture, &server.url(name, "/")).await;
        assert_eq!(failure(reply), FailureReason::NotPublicAddress, "{name}");
    }
    assert_eq!(table.asked().len(), 6);
    assert_eq!(server.connections(), 0);
}

#[tokio::test]
async fn the_production_policy_refuses_the_listening_loopback_server() {
    let server = Server::http(|_, stream| html(stream, "<p>never</p>"));
    let port = server.port();

    // The production constructor itself: these are refused before any lookup.
    let production = WebCapture::new();
    for url in [
        format!("http://127.0.0.1:{port}/"),
        format!("http://localhost:{port}/"),
        format!("http://app.localhost:{port}/"),
        format!("http://[::1]:{port}/"),
        format!("http://[::ffff:127.0.0.1]:{port}/"),
        format!("http://0x7f.0.0.1:{port}/"),
        format!("http://2130706433:{port}/"),
    ] {
        let reply = production.fetch("main", fetch_args(1, &url)).await;
        assert_eq!(failure(reply), FailureReason::NotPublicAddress, "{url}");
    }

    // The production policy with names that resolve to this machine.
    let table = Arc::new(
        Table::new()
            .with("loop.test", &["127.0.0.1"])
            .with("loop-v6.test", &["::1"])
            .with("mapped.test", &["::ffff:127.0.0.1"])
            .with("nat64.test", &["64:ff9b::7f00:1"]),
    );
    let public_only = WebCapture::for_tests(AddressPolicy::Public, table, test_limits());
    for name in ["loop.test", "loop-v6.test", "mapped.test", "nat64.test"] {
        let reply = fetch(&public_only, &server.url(name, "/")).await;
        assert_eq!(failure(reply), FailureReason::NotPublicAddress, "{name}");
    }
    assert_eq!(server.connections(), 0);
}

#[tokio::test]
async fn lookups_that_fail_or_stall_are_refused() {
    let table = Arc::new(
        Table::new()
            .answering("gone.test", Answer::Fails)
            .with("empty.test", &[])
            .answering("slow.test", Answer::Stalls),
    );
    let limits = Limits {
        dns: Duration::from_millis(200),
        ..test_limits()
    };
    let capture = loopback_capture(&table, limits);

    for name in ["gone.test", "empty.test", "unknown.test"] {
        let reply = fetch(&capture, &format!("http://{name}/")).await;
        assert_eq!(failure(reply), FailureReason::DnsFailed, "{name}");
    }
    let started = Instant::now();
    let reply = fetch(&capture, "http://slow.test/").await;
    assert_eq!(failure(reply), FailureReason::TimedOut);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn redirects_are_followed_by_hand_with_a_fresh_check_each_hop() {
    let server = Server::http(|request, stream| match request.target.as_str() {
        "/start" => respond(
            stream,
            302,
            &[
                ("Location", "/second#ignored"),
                ("Set-Cookie", "session=secret"),
            ],
            b"",
        ),
        "/second" => {
            let location = format!("http://other.test:{}/third", host_port(request));
            respond(stream, 301, &[("Location", location.as_str())], b"");
        }
        "/third" => html(stream, "<p>arrived</p>"),
        _ => respond(stream, 404, &[], b""),
    });
    let table = loopback_names(&["capture.test", "other.test"]);
    let capture = loopback_capture(&table, test_limits());

    let page = fetched(fetch(&capture, &server.url("capture.test", "/start")).await);

    assert_eq!(page.requested_url, server.url("capture.test", "/start"));
    assert_eq!(page.final_url, server.url("other.test", "/third"));
    assert_eq!(page.html, "<p>arrived</p>");
    let port = server.port();
    assert_eq!(
        table.asked(),
        [
            ("capture.test".to_string(), port),
            ("capture.test".to_string(), port),
            ("other.test".to_string(), port),
        ]
    );
    let requests = server.requests();
    let hops: Vec<(&str, Option<&str>)> = requests
        .iter()
        .map(|request| (request.target.as_str(), request.header("host")))
        .collect();
    let (first, second) = (format!("capture.test:{port}"), format!("other.test:{port}"));
    assert_eq!(
        hops,
        [
            ("/start", Some(first.as_str())),
            ("/second", Some(first.as_str())),
            ("/third", Some(second.as_str())),
        ]
    );
    // No cookie was kept and no Referer was sent on later hops.
    for request in &requests {
        assert_eq!(
            request.header_names(),
            ["accept", "accept-encoding", "host", "user-agent"]
        );
    }
}

#[tokio::test]
async fn five_redirects_are_followed_and_a_sixth_is_refused() {
    let server = Server::http(|request, stream| {
        let (chain, step) = request.target.rsplit_once('/').expect("a step");
        let step: usize = step.parse().expect("a number");
        if chain == "/ok" && step == 5 {
            html(stream, "<p>end</p>");
        } else {
            let location = format!("{chain}/{}", step + 1);
            respond(stream, 302, &[("Location", location.as_str())], b"");
        }
    });
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());

    let page = fetched(fetch(&capture, &server.url("capture.test", "/ok/0")).await);
    assert_eq!(page.final_url, server.url("capture.test", "/ok/5"));
    let reply = fetch(&capture, &server.url("capture.test", "/loop/0")).await;
    assert_eq!(failure(reply), FailureReason::TooManyRedirects);

    let targets: Vec<String> = server
        .requests()
        .into_iter()
        .map(|request| request.target)
        .collect();
    let expected: Vec<String> = (0..=5)
        .map(|step| format!("/ok/{step}"))
        .chain((0..=5).map(|step| format!("/loop/{step}")))
        .collect();
    assert_eq!(targets, expected);
}

#[tokio::test]
async fn a_refused_redirect_target_is_never_requested() {
    let server = Server::http(|request, stream| {
        let port = host_port(request);
        let location = match request.target.as_str() {
            "/private-literal" => Some("http://10.0.0.1/".to_string()),
            "/private-name" => Some(format!("http://private.test:{port}/")),
            "/localhost" => Some(format!("http://localhost:{port}/")),
            "/ftp" => Some("ftp://capture.test/".to_string()),
            "/file" => Some("file:///etc/hosts".to_string()),
            "/credentials" => Some(format!("http://user:pw@capture.test:{port}/")),
            "/unparseable" => Some("http://[::1".to_string()),
            _ => None,
        };
        match location {
            Some(location) => respond(stream, 302, &[("Location", location.as_str())], b""),
            None => respond(stream, 302, &[], b""),
        }
    });
    let table = Arc::new(
        Table::new()
            .with("capture.test", &["127.0.0.1"])
            .with("private.test", &["192.168.1.20"]),
    );
    let capture = loopback_capture(&table, test_limits());

    let cases = [
        ("/private-literal", FailureReason::NotPublicAddress),
        ("/private-name", FailureReason::NotPublicAddress),
        ("/localhost", FailureReason::NotPublicAddress),
        ("/ftp", FailureReason::UnsupportedScheme),
        ("/file", FailureReason::UnsupportedScheme),
        ("/credentials", FailureReason::CredentialsInUrl),
        ("/unparseable", FailureReason::InvalidRedirect),
        ("/missing", FailureReason::InvalidRedirect),
    ];
    for (path, expected) in cases {
        let reply = fetch(&capture, &server.url("capture.test", path)).await;
        assert_eq!(failure(reply), expected, "{path}");
    }
    let targets: Vec<String> = server
        .requests()
        .into_iter()
        .map(|request| request.target)
        .collect();
    assert_eq!(targets, cases.map(|(path, _)| path.to_string()));
    assert_eq!(server.connections(), cases.len());
}

#[tokio::test]
async fn statuses_map_to_fixed_reasons_without_server_text_or_retries() {
    let server = Server::http(|request, stream| {
        let status: u16 = request
            .target
            .trim_start_matches('/')
            .parse()
            .expect("a status");
        respond(
            stream,
            status,
            &[("Content-Type", "text/html")],
            b"<p>SERVER-TEXT-NEVER-ECHOED</p>",
        );
    });
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());

    let cases = [
        (401, FailureReason::AccessDenied),
        (402, FailureReason::AccessDenied),
        (403, FailureReason::AccessDenied),
        (451, FailureReason::AccessDenied),
        (404, FailureReason::NotFound),
        (410, FailureReason::NotFound),
        (429, FailureReason::RateLimited),
        (500, FailureReason::ServerError),
        (502, FailureReason::ServerError),
        (503, FailureReason::ServerError),
        (599, FailureReason::ServerError),
        (204, FailureReason::UnexpectedStatus),
        (206, FailureReason::UnexpectedStatus),
        (300, FailureReason::UnexpectedStatus),
        (304, FailureReason::UnexpectedStatus),
        (418, FailureReason::UnexpectedStatus),
    ];
    for (status, expected) in cases {
        let reply = fetch(&capture, &server.url("capture.test", &format!("/{status}"))).await;
        let json = serde_json::to_string(&reply).expect("serializable");
        assert!(!json.contains("SERVER-TEXT"), "{json}");
        assert_eq!(failure(reply), expected, "{status}");
    }
    assert_eq!(
        server.requests().len(),
        cases.len(),
        "one request each, no retry"
    );
}

#[tokio::test]
async fn only_identity_html_is_accepted() {
    let server = Server::http(|request, stream| {
        let html_type = ("Content-Type", "text/html");
        match request.target.as_str() {
            "/gzip" => respond(
                stream,
                200,
                &[html_type, ("Content-Encoding", "gzip")],
                b"\x1f\x8b",
            ),
            "/br" => respond(stream, 200, &[html_type, ("Content-Encoding", "br")], b"x"),
            "/listed" => respond(
                stream,
                200,
                &[html_type, ("Content-Encoding", "identity, gzip")],
                b"x",
            ),
            "/transfer" => respond(
                stream,
                200,
                &[html_type, ("Transfer-Encoding", "gzip, chunked")],
                b"5\r\nhello\r\n0\r\n\r\n",
            ),
            "/identity" => respond(
                stream,
                200,
                &[html_type, ("Content-Encoding", "identity")],
                b"<p>identity</p>",
            ),
            "/chunked" => respond(
                stream,
                200,
                &[html_type, ("Transfer-Encoding", "chunked")],
                b"5\r\n<p>ok\r\n4\r\n</p>\r\n0\r\n\r\n",
            ),
            "/plain" => respond(stream, 200, &[("Content-Type", "text/plain")], b"<html>"),
            "/json" => respond(stream, 200, &[("Content-Type", "application/json")], b"{}"),
            "/png" => respond(stream, 200, &[("Content-Type", "image/png")], b"\x89PNG"),
            "/pdf" => respond(stream, 200, &[("Content-Type", "application/pdf")], b"%PDF"),
            "/xhtml" => respond(
                stream,
                200,
                &[("Content-Type", "application/xhtml+xml; charset=utf-8")],
                b"<html xmlns=\"http://www.w3.org/1999/xhtml\"/>",
            ),
            "/untyped-html" => respond(stream, 200, &[], b"<!doctype html><p>sniffed</p>"),
            "/untyped-json" => respond(stream, 200, &[], b"{\"html\": true}"),
            "/windows-1252" => respond(
                stream,
                200,
                &[("Content-Type", "text/html; charset=windows-1252")],
                b"<p>caf\xE9 \x93quoted\x94</p>",
            ),
            _ => respond(stream, 404, &[], b""),
        }
    });
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());
    let url = |path: &str| server.url("capture.test", path);

    for path in ["/gzip", "/br", "/listed", "/transfer"] {
        let reply = fetch(&capture, &url(path)).await;
        assert_eq!(failure(reply), FailureReason::CompressedResponse, "{path}");
    }
    for path in ["/plain", "/json", "/png", "/pdf", "/untyped-json"] {
        let reply = fetch(&capture, &url(path)).await;
        assert_eq!(failure(reply), FailureReason::NotHtml, "{path}");
    }

    assert_eq!(
        fetched(fetch(&capture, &url("/identity")).await).html,
        "<p>identity</p>"
    );
    assert_eq!(
        fetched(fetch(&capture, &url("/chunked")).await).html,
        "<p>ok</p>"
    );
    let xhtml = fetched(fetch(&capture, &url("/xhtml")).await);
    assert_eq!(xhtml.content_type, ContentType::Xhtml);
    let sniffed = fetched(fetch(&capture, &url("/untyped-html")).await);
    assert_eq!(
        (sniffed.content_type, sniffed.encoding_source),
        (ContentType::Html, EncodingSource::Detected)
    );
    let legacy = fetched(fetch(&capture, &url("/windows-1252")).await);
    assert_eq!(
        (
            legacy.html.as_str(),
            legacy.encoding,
            legacy.encoding_source
        ),
        (
            "<p>café “quoted”</p>",
            "windows-1252",
            EncodingSource::Header
        )
    );
}

#[tokio::test]
async fn an_oversized_content_length_is_refused_before_the_body_is_read() {
    let closed = flag();
    let server = Server::http({
        let closed = Arc::clone(&closed);
        move |_, stream| {
            // Promises a body it never sends: reading it would wait for the idle timeout.
            write_raw(
                stream,
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 4096\r\n\r\n",
            );
            if wait_closed(stream, Duration::from_secs(5)) {
                closed.store(true, Ordering::SeqCst);
            }
        }
    });
    let limits = Limits {
        body_bytes: 1024,
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let started = Instant::now();
    let reply = fetch(&capture, &server.url("capture.test", "/")).await;
    assert_eq!(failure(reply), FailureReason::TooLarge);
    assert!(
        started.elapsed() < limits.read_idle,
        "{:?}",
        started.elapsed()
    );
    until("the connection to close", || is_set(&closed)).await;
}

#[tokio::test]
async fn a_body_without_a_length_stops_one_read_past_the_limit() {
    let closed = flag();
    let server = Server::http({
        let closed = Arc::clone(&closed);
        move |_, stream| {
            write_raw(
                stream,
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n",
            );
            let mut chunk = b"200\r\n".to_vec();
            chunk.extend_from_slice(&[b'a'; 512]);
            chunk.extend_from_slice(b"\r\n");
            for _ in 0..3 {
                write_raw(stream, &chunk);
            }
            // No final chunk: only the client's own limit can end this.
            if wait_closed(stream, Duration::from_secs(5)) {
                closed.store(true, Ordering::SeqCst);
            }
        }
    });
    let limits = Limits {
        body_bytes: 1024,
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let reply = fetch(&capture, &server.url("capture.test", "/")).await;
    assert_eq!(failure(reply), FailureReason::TooLarge);
    until("the connection to close", || is_set(&closed)).await;
}

#[tokio::test]
async fn bodies_and_decoded_text_each_have_an_inclusive_limit() {
    let server = Server::http(|request, stream| {
        let (body, charset) = match request.target.as_str() {
            "/exact" => (vec![b'a'; 1024], "utf-8"),
            "/over" => (vec![b'a'; 1025], "utf-8"),
            // Each byte decodes to two UTF-8 bytes.
            "/expands-to-limit" => (vec![0xE9; 512], "windows-1252"),
            "/expands-past-limit" => (vec![0xE9; 600], "windows-1252"),
            _ => (Vec::new(), "utf-8"),
        };
        let content_type = format!("text/html; charset={charset}");
        respond(
            stream,
            200,
            &[("Content-Type", content_type.as_str())],
            &body,
        );
    });
    let limits = Limits {
        body_bytes: 1024,
        html_bytes: 1024,
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);
    let url = |path: &str| server.url("capture.test", path);

    assert_eq!(
        fetched(fetch(&capture, &url("/exact")).await).html.len(),
        1024
    );
    assert_eq!(
        failure(fetch(&capture, &url("/over")).await),
        FailureReason::TooLarge
    );
    let expanded = fetched(fetch(&capture, &url("/expands-to-limit")).await);
    assert_eq!(expanded.html, "é".repeat(512));
    assert_eq!(
        failure(fetch(&capture, &url("/expands-past-limit")).await),
        FailureReason::TooLarge
    );
}

#[tokio::test]
async fn a_silent_server_times_out_waiting_for_its_response() {
    let server = Server::http(|_, stream| {
        wait_closed(stream, Duration::from_secs(5));
    });
    let limits = Limits {
        read_idle: Duration::from_millis(300),
        total: Duration::from_secs(10),
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let started = Instant::now();
    let reply = fetch(&capture, &server.url("capture.test", "/")).await;
    assert_eq!(failure(reply), FailureReason::TimedOut);
    assert!(
        started.elapsed() < Duration::from_millis(2500),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_body_that_goes_quiet_times_out() {
    let server = Server::http(|_, stream| {
        write_raw(
            stream,
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1000\r\n\r\n<p>partial",
        );
        wait_closed(stream, Duration::from_secs(5));
    });
    let limits = Limits {
        read_idle: Duration::from_millis(300),
        total: Duration::from_secs(10),
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let started = Instant::now();
    let reply = fetch(&capture, &server.url("capture.test", "/")).await;
    assert_eq!(failure(reply), FailureReason::TimedOut);
    assert!(
        started.elapsed() < Duration::from_millis(2500),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn the_whole_attempt_has_a_deadline_even_while_bytes_trickle_in() {
    // Under the body limit, and far more than the trickle below can send (at most 80 bytes in
    // 8 s), so neither the size guard nor completion can end the attempt: only the deadline can.
    const ANNOUNCED: usize = 4096;
    let server = Server::http(|_, stream| {
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {ANNOUNCED}\r\n\r\n"
        );
        write_raw(stream, head.as_bytes());
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline && write_raw(stream, b"a") {
            std::thread::sleep(Duration::from_millis(100));
        }
    });
    let limits = Limits {
        read_idle: Duration::from_secs(1),
        total: Duration::from_millis(1500),
        ..test_limits()
    };
    assert!(
        ANNOUNCED <= limits.body_bytes,
        "the fixture must stay under its body limit"
    );
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let started = Instant::now();
    let reply = fetch(&capture, &server.url("capture.test", "/")).await;
    let elapsed = started.elapsed();
    assert_eq!(failure(reply), FailureReason::TimedOut);
    assert!(elapsed >= Duration::from_millis(1400), "{elapsed:?}");
    assert!(elapsed < Duration::from_secs(4), "{elapsed:?}");
}

#[tokio::test]
async fn a_stalled_tls_handshake_hits_the_connect_timeout() {
    let hello = flag();
    let server = Server::raw({
        let hello = Arc::clone(&hello);
        move |stream| {
            if read_client_hello(stream).is_some() {
                hello.store(true, Ordering::SeqCst);
            }
            wait_closed(stream, Duration::from_secs(5));
        }
    });
    let limits = Limits {
        connect: Duration::from_millis(300),
        read_idle: Duration::from_secs(5),
        total: Duration::from_secs(10),
        ..test_limits()
    };
    let capture = loopback_capture(&loopback_names(&["capture.test"]), limits);

    let started = Instant::now();
    let url = format!("https://capture.test:{}/", server.port());
    let reply = fetch(&capture, &url).await;
    assert_eq!(failure(reply), FailureReason::TimedOut);
    assert!(
        started.elapsed() < Duration::from_millis(2500),
        "{:?}",
        started.elapsed()
    );
    until("the TLS handshake to have started", || is_set(&hello)).await;
}

#[tokio::test]
async fn a_failed_tls_handshake_is_reported_and_named_the_host_not_the_address() {
    let names: Arc<Mutex<Vec<Option<String>>>> = Arc::default();
    let server = Server::raw({
        let names = Arc::clone(&names);
        move |stream| {
            if let Some(hello) = read_client_hello(stream) {
                names.lock().expect("names").push(server_name(&hello));
                // Plain HTTP where a TLS handshake reply belongs.
                write_raw(
                    stream,
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n",
                );
                wait_closed(stream, Duration::from_secs(5));
            }
        }
    });
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());

    let url = format!("https://capture.test:{}/", server.port());
    let reply = fetch(&capture, &url).await;

    assert_eq!(failure(reply), FailureReason::TlsFailed);
    let names = names.lock().expect("names").clone();
    assert_eq!(names, [Some("capture.test".to_string())]);
}

#[tokio::test]
async fn connection_failures_are_told_apart() {
    let closed_port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("address").port()
    };
    let server = Server::http(|_, stream| {
        write_raw(
            stream,
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 100\r\n\r\n<p>cut",
        );
    });
    let capture = loopback_capture(&loopback_names(&["capture.test"]), test_limits());

    let refused = fetch(&capture, &format!("http://capture.test:{closed_port}/")).await;
    assert_eq!(failure(refused), FailureReason::ConnectFailed);
    let cut = fetch(&capture, &server.url("capture.test", "/")).await;
    assert_eq!(failure(cut), FailureReason::NetworkError);
}
