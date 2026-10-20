//! Strict JSON for extension packages: RFC 8259 syntax with `JSON.parse`'s meaning, plus what
//! `JSON.parse` hides, exactly as the TypeScript validator checks it: bracket nesting counted on
//! the text itself (so a member a later duplicate replaces still counts), duplicate keys compared
//! after escapes are decoded, and every number token as written.

use std::collections::HashSet;

use super::report::{index, pointer, shown, Code, Report};

pub(crate) const MAX_PACKAGE_BYTES: usize = 128 * 1024;
pub(crate) const MAX_DEPTH: usize = 12;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub(crate) enum Json {
    Null,
    Bool(bool),
    /// The token exactly as written.
    Number(String),
    String(Text),
    Array(Vec<Json>),
    /// Members in text order, duplicates included; a package with duplicates never gets past
    /// the first stage.
    Object(Vec<(Text, Json)>),
}

/// A decoded JSON string. JavaScript keeps an unpaired surrogate; a Rust string cannot, so it
/// becomes U+FFFD in `text` and the exact UTF-16 units are kept to compare keys exactly.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Text {
    pub(crate) text: String,
    pub(crate) units: Option<Vec<u16>>,
}

impl Text {
    pub(crate) fn is(&self, expected: &str) -> bool {
        self.units.is_none() && self.text == expected
    }
}

/// Reads package text: size, then nesting on the raw text, then syntax, then duplicate keys and
/// number tokens in document order. `None` with the reason in `report` when any stage fails.
pub(crate) fn read(text: &str, report: &mut Report) -> Option<Json> {
    if text.len() > MAX_PACKAGE_BYTES {
        report.add(
            Code::TooLarge,
            "",
            format!(
                "The package is {} bytes; the limit is {MAX_PACKAGE_BYTES}.",
                text.len()
            ),
        );
        return None;
    }
    if nests_deeper_than(text, MAX_DEPTH) {
        report.add(
            Code::TooDeep,
            "",
            format!("Objects and arrays nest more than {MAX_DEPTH} levels deep."),
        );
        return None;
    }
    let mut tokens = Report::default();
    let parsed = Parser {
        bytes: text.as_bytes(),
        text,
        at: 0,
        report: &mut tokens,
    }
    .document();
    match parsed {
        Ok(value) => {
            report.absorb(tokens);
            Some(value)
        }
        Err(message) => {
            report.add(
                Code::InvalidJson,
                "",
                format!("The package is not valid JSON ({message})."),
            );
            None
        }
    }
}

/// Brackets outside strings only; malformed text is counted, never parsed. The count may go
/// below zero on malformed text, exactly as the TypeScript scan's does.
pub(crate) fn nests_deeper_than(text: &str, limit: usize) -> bool {
    let bytes = text.as_bytes();
    let limit = limit as i64;
    let mut depth: i64 = 0;
    let mut in_string = false;
    let mut at = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        if in_string {
            if byte == b'\\' {
                at += 1;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
        } else if byte == b'{' || byte == b'[' {
            depth += 1;
            if depth > limit {
                return true;
            }
        } else if byte == b'}' || byte == b']' {
            depth -= 1;
        }
        at += 1;
    }
    false
}

/// `0` or a non-zero digit run, optionally negative, within ±(2^53 − 1); no fraction, exponent,
/// plus sign, leading zero or minus zero.
pub(crate) fn is_plain_safe_integer(token: &str) -> bool {
    if token == "0" {
        return true;
    }
    let digits = token.strip_prefix('-').unwrap_or(token);
    let plain = !digits.is_empty()
        && digits.len() <= 16
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit());
    plain
        && digits
            .parse::<u64>()
            .is_ok_and(|value| value <= MAX_SAFE_INTEGER)
}

struct Parser<'a> {
    bytes: &'a [u8],
    text: &'a str,
    at: usize,
    report: &'a mut Report,
}

impl Parser<'_> {
    fn document(&mut self) -> Result<Json, String> {
        self.skip_space();
        let value = self.value("")?;
        self.skip_space();
        if self.at != self.bytes.len() {
            return Err(self.error("more text after the package"));
        }
        Ok(value)
    }

    fn error(&self, what: &str) -> String {
        format!("{what} at byte {}", self.at)
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn value(&mut self, path: &str) -> Result<Json, String> {
        match self.peek() {
            Some(b'{') => self.object(path),
            Some(b'[') => self.array(path),
            Some(b'"') => self.string().map(Json::String),
            Some(b't') => self.word("true", Json::Bool(true)),
            Some(b'f') => self.word("false", Json::Bool(false)),
            Some(b'n') => self.word("null", Json::Null),
            Some(b'-' | b'0'..=b'9') => self.number(path),
            Some(_) => Err(self.error("unexpected character")),
            None => Err(self.error("unexpected end")),
        }
    }

    fn word(&mut self, word: &str, value: Json) -> Result<Json, String> {
        let bytes = self.bytes;
        if bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            Err(self.error("unexpected word"))
        }
    }

    fn object(&mut self, path: &str) -> Result<Json, String> {
        self.at += 1;
        let mut members: Vec<(Text, Json)> = Vec::new();
        let mut seen: HashSet<Text> = HashSet::new();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Json::Object(members));
        }
        loop {
            self.skip_space();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a quoted key"));
            }
            let key = self.string()?;
            let at = pointer(path, &key.text);
            if !seen.insert(key.clone()) {
                self.report.add(
                    Code::DuplicateKey,
                    &at,
                    format!(
                        "\"{}\" appears more than once in one object; keep only one.",
                        shown(&key.text)
                    ),
                );
            }
            self.skip_space();
            if self.peek() != Some(b':') {
                return Err(self.error("expected ':'"));
            }
            self.at += 1;
            self.skip_space();
            let value = self.value(&at)?;
            members.push((key, value));
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Json::Object(members));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn array(&mut self, path: &str) -> Result<Json, String> {
        self.at += 1;
        let mut items: Vec<Json> = Vec::new();
        self.skip_space();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Json::Array(items));
        }
        loop {
            self.skip_space();
            let item = self.value(&index(path, items.len()))?;
            items.push(item);
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    /// Decodes to UTF-16 units first, as JavaScript does, then to text.
    fn string(&mut self) -> Result<Text, String> {
        self.at += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            match self.peek() {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.at += 1;
                    return Ok(text_from_units(units));
                }
                Some(b'\\') => {
                    self.at += 1;
                    let unit = self.escape()?;
                    units.push(unit);
                }
                Some(0x00..=0x1f) => return Err(self.error("control character in a string")),
                Some(_) => {
                    let text = self.text;
                    let character = text[self.at..]
                        .chars()
                        .next()
                        .ok_or_else(|| self.error("unreadable character"))?;
                    let mut buffer = [0u16; 2];
                    units.extend_from_slice(character.encode_utf16(&mut buffer));
                    self.at += character.len_utf8();
                }
            }
        }
    }

    fn escape(&mut self) -> Result<u16, String> {
        let Some(byte) = self.peek() else {
            return Err(self.error("unterminated escape"));
        };
        self.at += 1;
        let unit = match byte {
            b'"' => 0x22,
            b'\\' => 0x5c,
            b'/' => 0x2f,
            b'b' => 0x08,
            b'f' => 0x0c,
            b'n' => 0x0a,
            b'r' => 0x0d,
            b't' => 0x09,
            b'u' => self.hex_unit()?,
            _ => return Err(self.error("unknown escape")),
        };
        Ok(unit)
    }

    fn hex_unit(&mut self) -> Result<u16, String> {
        let bytes = self.bytes;
        let Some(digits) = bytes.get(self.at..self.at + 4) else {
            return Err(self.error("short unicode escape"));
        };
        let mut unit: u16 = 0;
        for digit in digits {
            let Some(nibble) = (*digit as char).to_digit(16) else {
                return Err(self.error("bad unicode escape"));
            };
            unit = unit * 16 + nibble as u16;
        }
        self.at += 4;
        Ok(unit)
    }

    fn number(&mut self, path: &str) -> Result<Json, String> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        match self.peek() {
            Some(b'0') => self.at += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(self.error("bad number")),
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            self.required_digits()?;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            self.required_digits()?;
        }
        let token = self.text[start..self.at].to_string();
        if !is_plain_safe_integer(&token) {
            self.report.add(
                Code::InvalidNumber,
                path,
                format!(
                    "Write {} as a plain whole number without a fraction or exponent, within ±{MAX_SAFE_INTEGER}.",
                    shown(&token)
                ),
            );
        }
        Ok(Json::Number(token))
    }

    fn digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
    }

    fn required_digits(&mut self) -> Result<(), String> {
        if !matches!(self.peek(), Some(b'0'..=b'9')) {
            return Err(self.error("bad number"));
        }
        self.digits();
        Ok(())
    }
}

fn text_from_units(units: Vec<u16>) -> Text {
    let mut text = String::with_capacity(units.len());
    let mut unpaired = false;
    for decoded in char::decode_utf16(units.iter().copied()) {
        match decoded {
            Ok(character) => text.push(character),
            Err(_) => {
                unpaired = true;
                text.push(char::REPLACEMENT_CHARACTER);
            }
        }
    }
    Text {
        text,
        units: unpaired.then_some(units),
    }
}
