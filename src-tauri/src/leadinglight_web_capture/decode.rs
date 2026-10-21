//! Page bytes to text, in one documented order: byte order mark, then the `Content-Type` charset,
//! then the WHATWG `<meta>` prescan of the first 1024 bytes, then UTF-8 when every byte is valid
//! UTF-8, then windows-1252. Labels are read with the WHATWG label table in encoding_rs. This is
//! not full browser parity: XML declarations, a `<meta>` found later in the page, locale defaults
//! and statistical detection are not used. The source of the choice is always reported.

use encoding_rs::{Encoding, REPLACEMENT, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252, X_USER_DEFINED};

use super::wire::{EncodingSource, FailureReason};

const PRESCAN_BYTES: usize = 1024;
const SNIFF_BYTES: usize = 512;

#[derive(Debug)]
pub(super) struct Decoded {
    pub(super) html: String,
    pub(super) encoding: &'static Encoding,
    pub(super) source: EncodingSource,
    /// Some bytes were not valid in `encoding` and became U+FFFD.
    pub(super) had_replacements: bool,
}

pub(super) fn decode(body: &[u8], header_charset: Option<&str>) -> Result<Decoded, FailureReason> {
    if let Some((encoding, bom_length)) = Encoding::for_bom(body) {
        return Ok(decode_as(
            encoding,
            &body[bom_length..],
            EncodingSource::Bom,
        ));
    }
    let declared = header_charset.and_then(|label| Encoding::for_label(label.as_bytes()));
    let (encoding, source) = if let Some(encoding) = declared {
        (encoding, EncodingSource::Header)
    } else if let Some(encoding) = prescan(&body[..body.len().min(PRESCAN_BYTES)]) {
        (encoding, EncodingSource::Meta)
    } else if std::str::from_utf8(body).is_ok() {
        (UTF_8, EncodingSource::Detected)
    } else {
        (WINDOWS_1252, EncodingSource::Fallback)
    };
    // The WHATWG "replacement" encoding turns a whole page into one U+FFFD on purpose.
    if encoding == REPLACEMENT {
        return Err(FailureReason::UnsupportedCharset);
    }
    Ok(decode_as(encoding, body, source))
}

fn decode_as(encoding: &'static Encoding, bytes: &[u8], source: EncodingSource) -> Decoded {
    let (html, had_replacements) = encoding.decode_without_bom_handling(bytes);
    Decoded {
        html: html.into_owned(),
        encoding,
        source,
        had_replacements,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct MediaType {
    /// Lowercase `type/subtype`, without parameters.
    pub(super) essence: String,
    pub(super) charset: Option<String>,
}

/// A `Content-Type` value: its essence and first `charset` parameter (name matched ASCII
/// case-insensitively, surrounding whitespace and double quotes removed). `None` when unreadable.
pub(super) fn media_type(value: &[u8]) -> Option<MediaType> {
    let value = std::str::from_utf8(value).ok()?;
    let mut parts = value.split(';');
    let essence = parts.next()?.trim().to_ascii_lowercase();
    let charset = parts.find_map(|parameter| {
        let (name, value) = parameter.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches('"').trim().to_owned())
    });
    Some(MediaType { essence, charset })
}

/// With no `Content-Type`, a body is HTML only if, after an optional UTF-8 byte order mark and
/// whitespace, its first 512 bytes start with `<!doctype html` or `<html` and a tag-ending byte.
pub(super) fn looks_like_html(body: &[u8]) -> bool {
    let head = &body[..body.len().min(SNIFF_BYTES)];
    let head = head.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(head);
    let Some(start) = head.iter().position(|byte| !is_space(*byte)) else {
        return false;
    };
    let head = &head[start..];
    [b"<!doctype html".as_slice(), b"<html".as_slice()]
        .iter()
        .any(|pattern| {
            head.len() > pattern.len()
                && head[..pattern.len()].eq_ignore_ascii_case(pattern)
                && (is_space(head[pattern.len()]) || head[pattern.len()] == b'>')
        })
}

/// HTML's ASCII whitespace: tab, line feed, form feed, carriage return and space.
fn is_space(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0c | b'\r' | b' ')
}

/// The WHATWG "prescan a byte stream to determine its encoding" algorithm, on the bytes given.
/// Running out of bytes anywhere ends the prescan with no answer.
pub(super) fn prescan(input: &[u8]) -> Option<&'static Encoding> {
    let mut at = 0;
    while at < input.len() {
        let rest = &input[at..];
        if rest.starts_with(b"<!--") {
            // The '>' of the first "-->", whose dashes may be those of "<!--".
            at += 2 + find(&rest[2..], b"-->")? + 2;
        } else if is_meta_start(rest) {
            at += 5;
            if let Some(encoding) = meta(input, &mut at)? {
                return Some(encoding);
            }
        } else if is_tag_start(rest) {
            at += rest
                .iter()
                .position(|byte| is_space(*byte) || *byte == b'>')?;
            while attribute(input, &mut at)?.is_some() {}
        } else if rest.starts_with(b"<!") || rest.starts_with(b"</") || rest.starts_with(b"<?") {
            at += 1 + rest[1..].iter().position(|byte| *byte == b'>')?;
        }
        at += 1;
    }
    None
}

/// `<meta` followed by whitespace or `/`, ASCII case-insensitively.
fn is_meta_start(rest: &[u8]) -> bool {
    rest.len() > 5
        && rest[..5].eq_ignore_ascii_case(b"<meta")
        && (is_space(rest[5]) || rest[5] == b'/')
}

/// `<` and an ASCII letter, or `</` and an ASCII letter.
fn is_tag_start(rest: &[u8]) -> bool {
    match rest {
        [b'<', b'/', letter, ..] | [b'<', letter, ..] => letter.is_ascii_alphabetic(),
        _ => false,
    }
}

/// The attributes of one `<meta>`: `Some(None)` when it names no usable encoding, `None` when the
/// bytes ran out.
fn meta(input: &[u8], at: &mut usize) -> Option<Option<&'static Encoding>> {
    let mut seen: Vec<Vec<u8>> = Vec::new();
    let mut got_pragma = false;
    let mut need_pragma: Option<bool> = None;
    // `None` is the spec's null; `Some(None)` its failure.
    let mut charset: Option<Option<&'static Encoding>> = None;
    while let Some((name, value)) = attribute(input, at)? {
        if seen.contains(&name) {
            continue;
        }
        match name.as_slice() {
            b"http-equiv" if value == b"content-type" => got_pragma = true,
            b"content" if charset.is_none() => {
                if let Some(encoding) = encoding_from_content(&value) {
                    charset = Some(Some(encoding));
                    need_pragma = Some(true);
                }
            }
            b"charset" => {
                charset = Some(Encoding::for_label(&value));
                need_pragma = Some(false);
            }
            _ => {}
        }
        seen.push(name);
    }
    let usable = need_pragma.is_some_and(|need| got_pragma || !need);
    Some(match charset {
        Some(Some(encoding)) if usable => Some(meta_encoding(encoding)),
        _ => None,
    })
}

/// A `<meta>` cannot select UTF-16 (the bytes were read as ASCII-compatible) or x-user-defined.
fn meta_encoding(encoding: &'static Encoding) -> &'static Encoding {
    if encoding == UTF_16BE || encoding == UTF_16LE {
        UTF_8
    } else if encoding == X_USER_DEFINED {
        WINDOWS_1252
    } else {
        encoding
    }
}

type Attribute = (Vec<u8>, Vec<u8>);

/// The WHATWG "get an attribute" steps. `Some(None)` means there is no further attribute (the
/// position is at `>`); `None` means the bytes ran out. Names and values are ASCII-lowercased.
fn attribute(input: &[u8], at: &mut usize) -> Option<Option<Attribute>> {
    while is_space(*input.get(*at)?) || input[*at] == b'/' {
        *at += 1;
    }
    if input[*at] == b'>' {
        return Some(None);
    }
    let mut name = Vec::new();
    let mut value = Vec::new();
    loop {
        let byte = *input.get(*at)?;
        match byte {
            b'=' if !name.is_empty() => {
                *at += 1;
                break;
            }
            byte if is_space(byte) => {
                while is_space(*input.get(*at)?) {
                    *at += 1;
                }
                if input[*at] != b'=' {
                    return Some(Some((name, value)));
                }
                *at += 1;
                break;
            }
            b'/' | b'>' => return Some(Some((name, value))),
            byte => name.push(byte.to_ascii_lowercase()),
        }
        *at += 1;
    }
    while is_space(*input.get(*at)?) {
        *at += 1;
    }
    match input[*at] {
        quote @ (b'"' | b'\'') => loop {
            *at += 1;
            let byte = *input.get(*at)?;
            if byte == quote {
                *at += 1;
                return Some(Some((name, value)));
            }
            value.push(byte.to_ascii_lowercase());
        },
        b'>' => return Some(Some((name, value))),
        byte => {
            value.push(byte.to_ascii_lowercase());
            *at += 1;
        }
    }
    loop {
        let byte = *input.get(*at)?;
        if is_space(byte) || byte == b'>' {
            return Some(Some((name, value)));
        }
        value.push(byte.to_ascii_lowercase());
        *at += 1;
    }
}

/// The WHATWG "extract a character encoding from a meta element" steps for a `content` value.
fn encoding_from_content(value: &[u8]) -> Option<&'static Encoding> {
    let mut from = 0;
    loop {
        let mut at = from + find_ignore_case(&value[from..], b"charset")? + b"charset".len();
        while value.get(at).is_some_and(|byte| is_space(*byte)) {
            at += 1;
        }
        if value.get(at) != Some(&b'=') {
            from = at;
            continue;
        }
        at += 1;
        while value.get(at).is_some_and(|byte| is_space(*byte)) {
            at += 1;
        }
        let rest = &value[at..];
        return match *rest.first()? {
            quote @ (b'"' | b'\'') => {
                let length = rest[1..].iter().position(|byte| *byte == quote)?;
                Encoding::for_label(&rest[1..1 + length])
            }
            _ => {
                let length = rest
                    .iter()
                    .position(|byte| is_space(*byte) || *byte == b';')
                    .unwrap_or(rest.len());
                Encoding::for_label(&rest[..length])
            }
        };
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_ignore_case(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}
