use std::net::IpAddr;

use reqwest::Url;

use super::address::{is_public, parse_request, redirect_target, Target, MAX_URL_BYTES};
use super::wire::FailureReason;
use super::AddressPolicy;

fn ip(text: &str) -> IpAddr {
    text.parse().expect("an IP address")
}

fn refusal(input: &str) -> FailureReason {
    parse_request(input, AddressPolicy::Public).expect_err(input)
}

fn accepted(input: &str) -> (String, Target) {
    let (url, target) = parse_request(input, AddressPolicy::Public).expect(input);
    (url.to_string(), target)
}

#[test]
fn only_public_ipv4_addresses_are_public() {
    let non_public = [
        "0.0.0.0",
        "0.255.255.255",
        "10.0.0.1",
        "100.64.0.1",
        "100.127.255.255",
        "127.0.0.1",
        "127.255.255.254",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.8",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.1.1",
        "198.18.0.1",
        "198.19.255.255",
        "198.51.100.7",
        "203.0.113.9",
        "224.0.0.1",
        "239.255.255.250",
        "240.0.0.1",
        "255.255.255.255",
    ];
    for address in non_public {
        assert!(!is_public(ip(address)), "{address} must not be public");
    }
    let public = [
        "1.1.1.1",
        "8.8.8.8",
        "100.63.255.255",
        "100.128.0.1",
        "172.15.255.255",
        "172.32.0.1",
        "192.0.1.1",
        "192.88.98.1",
        "198.17.255.255",
        "198.20.0.1",
        "223.255.255.254",
    ];
    for address in public {
        assert!(is_public(ip(address)), "{address} must be public");
    }
}

#[test]
fn ipv6_is_public_only_inside_global_unicast_minus_special_blocks() {
    let non_public = [
        "::",
        "::1",
        "fe80::1",
        "fc00::1",
        "fd12:3456::1",
        "ff02::1",
        "2001::1",                // Teredo, inside 2001::/23
        "2001:1ff:ffff::1",       // last of 2001::/23
        "2001:db8::1",            // documentation
        "2002:c000:201::1",       // 6to4
        "3fff::1",                // documentation
        "3fff:fff:ffff::1",       // last of 3fff::/20
        "4000::1",                // outside 2000::/3
        "::127.0.0.1",            // deprecated IPv4-compatible
        "::8.8.8.8",              // deprecated IPv4-compatible
        "::ffff:127.0.0.1",       // mapped loopback
        "::ffff:10.0.0.1",        // mapped private
        "::ffff:169.254.169.254", // mapped link-local
        "64:ff9b::7f00:1",        // NAT64 of 127.0.0.1
        "64:ff9b::a00:1",         // NAT64 of 10.0.0.1
        "64:ff9b::c0a8:101",      // NAT64 of 192.168.1.1
        "64:ff9b:1::808:808",     // local-use NAT64 prefix
    ];
    for address in non_public {
        assert!(!is_public(ip(address)), "{address} must not be public");
    }
    let public = [
        "2001:200::1",
        "2606:4700:4700::1111",
        "2a00:1450:4001::1",
        "3fff:1000::1",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808", // NAT64 of 8.8.8.8
    ];
    for address in public {
        assert!(is_public(ip(address)), "{address} must be public");
    }
}

#[test]
fn the_test_policy_adds_only_loopback() {
    let test = AddressPolicy::PublicOrLoopback;
    assert!(test.allows(ip("127.0.0.1")));
    assert!(test.allows(ip("::1")));
    assert!(test.allows(ip("8.8.8.8")));
    for address in [
        "10.0.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "fe80::1",
        "0.0.0.0",
    ] {
        assert!(!test.allows(ip(address)), "{address}");
    }
    assert!(!AddressPolicy::Public.allows(ip("127.0.0.1")));
    assert!(!AddressPolicy::Public.allows(ip("::1")));
}

#[test]
fn local_hosts_in_any_spelling_are_refused_before_any_lookup() {
    for input in [
        "http://localhost/",
        "http://LOCALHOST:8080/",
        "http://localhost./",
        "http://app.localhost/",
        "http://local/",
        "http://printer.local/",
        "http://Printer.LOCAL./",
        "http://127.0.0.1/",
        "http://127.1/",
        "http://0x7f000001/",
        "http://0x7f.0.0.1/",
        "http://2130706433/",
        "http://0177.0.0.1/",
        "http://017700000001/",
        "http://0/",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://100.64.1.1/",
        "http://[::1]/",
        "http://[::]/",
        "http://[::ffff:7f00:1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[fe80::1]/",
        "http://[fd00::1]/",
        "http://[2001:db8::1]/",
        "http://[2002:c000:201::1]/",
        "http://[3fff::1]/",
        "http://[64:ff9b::a00:1]/",
    ] {
        assert_eq!(refusal(input), FailureReason::NotPublicAddress, "{input}");
    }
}

#[test]
fn only_http_and_https_are_fetched() {
    for input in [
        "ftp://example.com/file",
        "file:///etc/hosts",
        "javascript:alert(1)",
        "data:text/html,<p>hi</p>",
        "mailto:someone@example.com",
        "ws://example.com/",
        "about:blank",
    ] {
        assert_eq!(refusal(input), FailureReason::UnsupportedScheme, "{input}");
    }
}

#[test]
fn credentials_in_a_url_are_refused() {
    for input in [
        "http://user:secret@example.com/",
        "https://user@example.com/",
        "https://:secret@example.com/",
    ] {
        assert_eq!(refusal(input), FailureReason::CredentialsInUrl, "{input}");
    }
}

#[test]
fn unreadable_or_overlong_urls_are_invalid() {
    let long = format!("https://example.com/{}", "a".repeat(MAX_URL_BYTES));
    // Percent-encoding makes this one too long only after parsing.
    let grows = format!("https://example.com/{}end", " ".repeat(MAX_URL_BYTES / 2));
    for input in [
        "",
        "example.com",
        "/relative/path",
        "http://",
        "https://[::1",
        "http://exa mple.com/",
        "http://[fe80::1%25en0]/",
        long.as_str(),
        grows.as_str(),
    ] {
        assert_eq!(refusal(input), FailureReason::InvalidUrl, "{input}");
    }
}

#[test]
fn urls_are_normalized_and_fragments_removed() {
    assert_eq!(
        accepted("  HTTPS://Example.COM:443/a b?q=1#section  "),
        (
            "https://example.com/a%20b?q=1".to_string(),
            Target::Name("example.com".to_string()),
        )
    );
    assert_eq!(
        accepted("http://8.8.8.8:8080/x#y"),
        (
            "http://8.8.8.8:8080/x".to_string(),
            Target::Address(ip("8.8.8.8")),
        )
    );
    assert_eq!(
        accepted("https://[2606:4700:4700::1111]/"),
        (
            "https://[2606:4700:4700::1111]/".to_string(),
            Target::Address(ip("2606:4700:4700::1111")),
        )
    );
    assert_eq!(
        accepted("https://bücher.example/straße"),
        (
            "https://xn--bcher-kva.example/stra%C3%9Fe".to_string(),
            Target::Name("xn--bcher-kva.example".to_string()),
        )
    );
    // Not a local name: only exact labels count.
    assert_eq!(
        accepted("https://localhost.example.com/").1,
        Target::Name("localhost.example.com".to_string())
    );
}

fn hop(current: &str, location: Option<&[u8]>) -> Result<String, FailureReason> {
    let current = Url::parse(current).expect("a URL");
    redirect_target(&current, location, AddressPolicy::Public).map(|(url, _)| url.to_string())
}

#[test]
fn redirects_resolve_against_the_current_hop_and_drop_fragments() {
    assert_eq!(
        hop("https://example.com/a/b", Some(b"../c?d=1#e")),
        Ok("https://example.com/c?d=1".to_string())
    );
    assert_eq!(
        hop("http://example.com/", Some(b"https://example.org/secure")),
        Ok("https://example.org/secure".to_string())
    );
    assert_eq!(
        hop("https://example.com/", Some(b"//example.net/x")),
        Ok("https://example.net/x".to_string())
    );
    // A UTF-8 Location is percent-encoded, as browsers do.
    assert_eq!(
        hop("https://example.com/", Some("/café".as_bytes())),
        Ok("https://example.com/caf%C3%A9".to_string())
    );
}

#[test]
fn redirects_never_downgrade_or_leave_the_rules() {
    let cases: [(&str, Option<&[u8]>, FailureReason); 12] = [
        (
            "https://example.com/",
            Some(b"http://example.com/"),
            FailureReason::InsecureRedirect,
        ),
        (
            "https://example.com/",
            Some(b"http://8.8.8.8/"),
            FailureReason::InsecureRedirect,
        ),
        ("https://example.com/", None, FailureReason::InvalidRedirect),
        (
            "https://example.com/",
            Some(b""),
            FailureReason::InvalidRedirect,
        ),
        (
            "https://example.com/",
            Some(b"   "),
            FailureReason::InvalidRedirect,
        ),
        (
            "https://example.com/",
            Some(b"/\xff\xfe"),
            FailureReason::InvalidRedirect,
        ),
        (
            "https://example.com/",
            Some(b"http://[::1"),
            FailureReason::InvalidRedirect,
        ),
        (
            "https://example.com/",
            Some(b"ftp://example.com/"),
            FailureReason::UnsupportedScheme,
        ),
        (
            "http://example.com/",
            Some(b"file:///etc/passwd"),
            FailureReason::UnsupportedScheme,
        ),
        (
            "http://example.com/",
            Some(b"http://u:p@example.com/"),
            FailureReason::CredentialsInUrl,
        ),
        (
            "http://example.com/",
            Some(b"http://10.0.0.1/admin"),
            FailureReason::NotPublicAddress,
        ),
        (
            "http://example.com/",
            Some(b"//localhost:8080/"),
            FailureReason::NotPublicAddress,
        ),
    ];
    for (current, location, expected) in cases {
        assert_eq!(hop(current, location), Err(expected), "{location:?}");
    }
    let long = format!("/{}", "a".repeat(MAX_URL_BYTES));
    assert_eq!(
        hop("https://example.com/", Some(long.as_bytes())),
        Err(FailureReason::InvalidRedirect)
    );
}
