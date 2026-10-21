use super::decode::{decode, looks_like_html, media_type, prescan, MediaType};
use super::wire::{EncodingSource, FailureReason};

fn decoded(body: &[u8], header: Option<&str>) -> (String, &'static str, EncodingSource, bool) {
    let decoded = decode(body, header).expect("decodable");
    (
        decoded.html,
        decoded.encoding.name(),
        decoded.source,
        decoded.had_replacements,
    )
}

fn meta(head: &str) -> Option<&'static str> {
    prescan(head.as_bytes()).map(|encoding| encoding.name())
}

#[test]
fn a_byte_order_mark_beats_the_header_and_meta() {
    let mut body = b"\xEF\xBB\xBF<meta charset=\"windows-1252\"><p>".to_vec();
    body.extend_from_slice("café</p>".as_bytes());
    assert_eq!(
        decoded(&body, Some("iso-8859-2")),
        (
            "<meta charset=\"windows-1252\"><p>café</p>".to_string(),
            "UTF-8",
            EncodingSource::Bom,
            false
        )
    );
}

#[test]
fn utf16_needs_its_byte_order_mark() {
    let text = "<p>hé 日本</p>";
    let little: Vec<u8> = [0xFF, 0xFE]
        .into_iter()
        .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    let big: Vec<u8> = [0xFE, 0xFF]
        .into_iter()
        .chain(text.encode_utf16().flat_map(u16::to_be_bytes))
        .collect();
    assert_eq!(
        decoded(&little, Some("utf-8")),
        (text.to_string(), "UTF-16LE", EncodingSource::Bom, false)
    );
    assert_eq!(
        decoded(&big, None),
        (text.to_string(), "UTF-16BE", EncodingSource::Bom, false)
    );
}

#[test]
fn the_header_charset_beats_meta() {
    assert_eq!(
        decoded(
            b"<meta charset=\"utf-8\"><p>caf\xE9</p>",
            Some("ISO-8859-1")
        ),
        (
            "<meta charset=\"utf-8\"><p>café</p>".to_string(),
            "windows-1252",
            EncodingSource::Header,
            false
        )
    );
}

#[test]
fn an_unknown_header_label_is_ignored_and_meta_decides() {
    assert_eq!(
        decoded(
            b"<meta charset=\"iso-8859-2\"><p>\xB1</p>",
            Some("no-such-charset")
        ),
        (
            "<meta charset=\"iso-8859-2\"><p>ą</p>".to_string(),
            "ISO-8859-2",
            EncodingSource::Meta,
            false
        )
    );
}

#[test]
fn a_content_type_pragma_selects_shift_jis() {
    let body = b"<meta http-equiv=\"Content-Type\" content=\"text/html; charset=Shift_JIS\"><p>\x93\xFA\x96\x7B</p>";
    let (html, encoding, source, replaced) = decoded(body, None);
    assert!(html.ends_with("<p>日本</p>"), "{html}");
    assert_eq!(
        (encoding, source, replaced),
        ("Shift_JIS", EncodingSource::Meta, false)
    );
}

#[test]
fn undeclared_valid_utf8_is_detected() {
    assert_eq!(
        decoded("<p>naïve “quotes”</p>".as_bytes(), None),
        (
            "<p>naïve “quotes”</p>".to_string(),
            "UTF-8",
            EncodingSource::Detected,
            false
        )
    );
}

#[test]
fn undeclared_invalid_utf8_falls_back_to_windows_1252_as_a_guess() {
    assert_eq!(
        decoded(b"<p>\x93quoted\x94 caf\xE9</p>", None),
        (
            "<p>“quoted” café</p>".to_string(),
            "windows-1252",
            EncodingSource::Fallback,
            false
        )
    );
}

#[test]
fn bytes_invalid_in_the_declared_encoding_are_reported_as_replaced() {
    let (html, encoding, source, replaced) = decoded(b"<p>caf\xE9</p>", Some("utf-8"));
    assert_eq!(html, "<p>caf\u{FFFD}</p>");
    assert_eq!(
        (encoding, source, replaced),
        ("UTF-8", EncodingSource::Header, true)
    );

    let odd_utf16 = [0xFF, 0xFE, b'a', 0x00, b'b'];
    let (html, _, source, replaced) = decoded(&odd_utf16, None);
    assert_eq!(
        (html.as_str(), source, replaced),
        ("a\u{FFFD}", EncodingSource::Bom, true)
    );
}

#[test]
fn the_replacement_encoding_is_refused_not_decoded() {
    assert_eq!(
        decode(b"<p>text</p>", Some("iso-2022-kr")).err(),
        Some(FailureReason::UnsupportedCharset)
    );
    assert_eq!(
        decode(b"<meta charset=\"csiso2022kr\"><p>text</p>", None).err(),
        Some(FailureReason::UnsupportedCharset)
    );
}

#[test]
fn meta_only_counts_in_the_first_1024_bytes() {
    let mut body = format!("<p>{}</p>", "a".repeat(1100)).into_bytes();
    body.extend_from_slice(b"<meta charset=\"iso-8859-2\"><p>\xB1</p>");
    let (html, encoding, source, _) = decoded(&body, None);
    assert!(
        html.ends_with("<p>±</p>"),
        "decoded as windows-1252, not ISO-8859-2"
    );
    assert_eq!(
        (encoding, source),
        ("windows-1252", EncodingSource::Fallback)
    );
}

#[test]
fn the_meta_prescan_follows_the_whatwg_steps() {
    // Spellings that select an encoding.
    assert_eq!(meta("<meta charset=\"koi8-r\">"), Some("KOI8-R"));
    assert_eq!(meta("<meta charset='koi8-r'>"), Some("KOI8-R"));
    assert_eq!(meta("<meta charset=koi8-r>"), Some("KOI8-R"));
    assert_eq!(meta("<META CHARSET=KOI8-R>"), Some("KOI8-R"));
    assert_eq!(meta("<meta/charset=koi8-r>"), Some("KOI8-R"));
    assert_eq!(meta("<meta\ncharset = \"koi8-r\" >"), Some("KOI8-R"));
    assert_eq!(
        meta("<!doctype html><html><head><meta charset=koi8-r>"),
        Some("KOI8-R")
    );
    assert_eq!(
        meta("<meta content=\"text/html; charset='koi8-r'\" http-equiv=\"content-type\">"),
        Some("KOI8-R")
    );
    assert_eq!(
        meta("<meta http-equiv=content-type content=\"text/html;charset = koi8-r; x=y\">"),
        Some("KOI8-R")
    );
    // A tag's quoted '>' does not end the tag early.
    assert_eq!(meta("<a title=\">\"><meta charset=koi8-r>"), Some("KOI8-R"));
    // The first of duplicated attributes wins; `charset` beats an earlier `content`.
    assert_eq!(
        meta("<meta charset=koi8-r charset=iso-8859-2>"),
        Some("KOI8-R")
    );
    assert_eq!(
        meta("<meta http-equiv=content-type content=\"charset=iso-8859-2\" charset=koi8-r>"),
        Some("KOI8-R")
    );
    // A <meta> cannot pick UTF-16 or x-user-defined.
    assert_eq!(meta("<meta charset=\"utf-16le\">"), Some("UTF-8"));
    assert_eq!(
        meta("<meta charset=\"x-user-defined\">"),
        Some("windows-1252")
    );

    // Spellings that select nothing.
    assert_eq!(
        meta("<meta content=\"text/html; charset=koi8-r\">"),
        None,
        "no pragma"
    );
    assert_eq!(
        meta("<!-- <meta charset=koi8-r> -->"),
        None,
        "inside a comment"
    );
    assert_eq!(
        meta("<!--><meta charset=koi8-r>-->"),
        Some("KOI8-R"),
        "<!--> ends at once"
    );
    assert_eq!(meta("<metadata charset=koi8-r>"), None, "another element");
    assert_eq!(
        meta("<meta charset=\"no-such-charset\">"),
        None,
        "unknown label"
    );
    assert_eq!(meta("<meta charset=\"koi8-r"), None, "ran out mid-value");
    assert_eq!(
        meta("<?xml version=\"1.0\" encoding=\"koi8-r\"?>"),
        None,
        "XML declaration"
    );
    assert_eq!(
        meta("<meta http-equiv=content-type content='charset=\"koi8-r'>"),
        None,
        "unmatched quote"
    );
}

#[test]
fn content_types_give_their_essence_and_charset() {
    let parsed = |value: &str| media_type(value.as_bytes());
    assert_eq!(
        parsed("text/html; charset=\"UTF-8\""),
        Some(MediaType {
            essence: "text/html".to_string(),
            charset: Some("UTF-8".to_string()),
        })
    );
    assert_eq!(
        parsed(" TEXT/HTML ;q=1; Charset = koi8-r "),
        Some(MediaType {
            essence: "text/html".to_string(),
            charset: Some("koi8-r".to_string()),
        })
    );
    assert_eq!(
        parsed("application/xhtml+xml"),
        Some(MediaType {
            essence: "application/xhtml+xml".to_string(),
            charset: None,
        })
    );
    assert_eq!(media_type(b"text/html; charset=\xFF"), None);
}

#[test]
fn only_an_html_start_passes_the_missing_type_sniff() {
    let html: [&[u8]; 5] = [
        b"<!DOCTYPE html><title>t</title>",
        b"  \r\n<!doctype HTML >",
        b"<html lang=\"en\">",
        b"\xEF\xBB\xBF<html>",
        b"\t<HTML>",
    ];
    for body in html {
        assert!(looks_like_html(body), "{}", String::from_utf8_lossy(body));
    }
    let late = format!("{}<html>", " ".repeat(600));
    let not_html: [&[u8]; 7] = [
        b"",
        b"<htmlx>",
        b"<html",
        b"<p>hello</p>",
        b"<?xml version=\"1.0\"?><html>",
        b"{\"html\": true}",
        late.as_bytes(),
    ];
    for body in not_html {
        assert!(!looks_like_html(body), "{}", String::from_utf8_lossy(body));
    }
}
