//! Qualifies the website capture fetch leaf before the app registers it: this compiles
//! `src/leadinglight_web_capture` on its own, which runs every `cfg(test)` behavioral test inside
//! it, and adds the one test that changes process-wide state. Proxy variables are read by any
//! reqwest client that does not opt out, so that test lives in this binary, where every client is
//! a capture client that must ignore them.

#[allow(dead_code)]
#[path = "../src/leadinglight_web_capture/mod.rs"]
mod leadinglight_web_capture;

use std::sync::Arc;

use leadinglight_web_capture::test_server::{
    fetch_args, html, loopback_capture, respond, test_limits, Server, Table,
};
use leadinglight_web_capture::wire::FetchReply;

const PROXY_VARIABLES: [&str; 6] = [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
];

#[tokio::test]
async fn proxy_variables_never_redirect_a_capture() {
    let proxy = Server::http(|_, stream| respond(stream, 502, &[], b"proxy"));
    let origin = Server::http(|_, stream| html(stream, "<p>direct</p>"));
    let proxy_url = format!("http://127.0.0.1:{}", proxy.port());
    for name in PROXY_VARIABLES {
        std::env::set_var(name, &proxy_url);
    }
    std::env::remove_var("NO_PROXY");
    std::env::remove_var("no_proxy");

    let table = Arc::new(Table::new().with("capture.test", &["127.0.0.1"]));
    let capture = loopback_capture(&table, test_limits());
    let reply = capture
        .fetch("main", fetch_args(1, &origin.url("capture.test", "/page")))
        .await;

    for name in PROXY_VARIABLES {
        std::env::remove_var(name);
    }
    match reply {
        FetchReply::Fetched { html, .. } => assert_eq!(html, "<p>direct</p>"),
        other => panic!("expected the direct page, got {other:?}"),
    }
    assert_eq!(proxy.connections(), 0);
    let requests = origin.requests();
    assert_eq!(requests.len(), 1);
    // Origin form, not the absolute form a proxy request would use.
    assert_eq!(requests[0].target, "/page");
    assert_eq!(requests[0].header("proxy-authorization"), None);
}
