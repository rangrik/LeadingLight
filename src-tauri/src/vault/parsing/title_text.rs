//! LeadingLight: display text of an H1 title's inline Markdown.
//!
//! Mirrors src/utils/noteTitleInline.ts (live title and browser bridge); all three readers assert
//! src/shared/titleSourceContract.json. A bounded CommonMark subset, linear in the input
//! (docs/leadinglight/title-literal-text.md): backslash escapes, character references and code
//! spans first become literal text that can never open, close or split syntax, and `_` and `&`
//! inside bare http(s), www and email words stay as written. Wikilinks, links,
//! `~~strikethrough~~`, `*` and non-intraword `_` runs are then unwrapped as titles always were.

use std::collections::HashMap;
use std::ops::Range;

/// Names Markdown writers commonly emit; any other name stays literal. Same table as the renderer.
const NAMED_CHARACTER_REFERENCES: [(&str, u32); 48] = [
    ("amp", 0x26),
    ("AMP", 0x26),
    ("lt", 0x3c),
    ("LT", 0x3c),
    ("gt", 0x3e),
    ("GT", 0x3e),
    ("quot", 0x22),
    ("QUOT", 0x22),
    ("apos", 0x27),
    ("nbsp", 0xa0),
    ("ensp", 0x2002),
    ("emsp", 0x2003),
    ("thinsp", 0x2009),
    ("copy", 0xa9),
    ("COPY", 0xa9),
    ("reg", 0xae),
    ("REG", 0xae),
    ("trade", 0x2122),
    ("TRADE", 0x2122),
    ("hellip", 0x2026),
    ("mdash", 0x2014),
    ("ndash", 0x2013),
    ("lsquo", 0x2018),
    ("rsquo", 0x2019),
    ("sbquo", 0x201a),
    ("ldquo", 0x201c),
    ("rdquo", 0x201d),
    ("bdquo", 0x201e),
    ("laquo", 0xab),
    ("raquo", 0xbb),
    ("bull", 0x2022),
    ("middot", 0xb7),
    ("deg", 0xb0),
    ("times", 0xd7),
    ("divide", 0xf7),
    ("plusmn", 0xb1),
    ("minus", 0x2212),
    ("euro", 0x20ac),
    ("pound", 0xa3),
    ("yen", 0xa5),
    ("cent", 0xa2),
    ("sect", 0xa7),
    ("para", 0xb6),
    ("larr", 0x2190),
    ("uarr", 0x2191),
    ("rarr", 0x2192),
    ("darr", 0x2193),
    ("harr", 0x2194),
];
const MAX_NAMED_REFERENCE_LENGTH: usize = 32;
// Same automatic-link words and trailing punctuation as the extension literal-text encoder.
const AUTOMATIC_LINK_PREFIXES: [&str; 3] = ["https://", "http://", "www."];
const TRAILING_LINK_PUNCTUATION: &str = "!\"&')*,.:;?]_}~";

/// `Source` text may act as Markdown syntax. `Escaped` and `Literal` text never does, except that
/// an escaped `|` or `]` still bounds a wikilink, as the editor's raw `[[...]]` match sees them.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TitleUnitOrigin {
    Source,
    Escaped,
    Literal,
}

/// One title character and where it came from.
#[derive(Clone, Copy)]
struct TitleUnit {
    ch: char,
    origin: TitleUnitOrigin,
}

impl TitleUnit {
    fn literal_text(ch: char) -> Self {
        Self {
            ch,
            origin: TitleUnitOrigin::Literal,
        }
    }

    fn escaped(ch: char) -> Self {
        Self {
            ch,
            origin: TitleUnitOrigin::Escaped,
        }
    }

    fn source(ch: char) -> Self {
        Self {
            ch,
            origin: TitleUnitOrigin::Source,
        }
    }

    fn is_syntax(self, ch: char) -> bool {
        self.origin == TitleUnitOrigin::Source && self.ch == ch
    }

    /// Written in the raw source, escaped or not: what the editor's `[[...]]` match sees.
    fn is_raw(self, ch: char) -> bool {
        self.origin != TitleUnitOrigin::Literal && self.ch == ch
    }
}

/// Next index at or after each position holding the unit, or the unit count.
struct TitleSyntaxIndex {
    close_bracket: Vec<usize>,
    raw_close_bracket: Vec<usize>,
    close_paren: Vec<usize>,
    alias_pipe: Vec<usize>,
    tilde: Vec<usize>,
}

/// Units shown for a wikilink, link or strikethrough, and the position after its closing syntax.
struct TitleSpan {
    text: Range<usize>,
    next: usize,
}

/// Backtick run starts by run length, each with a cursor that only moves forward.
struct CodeSpanCloser {
    runs: HashMap<usize, (Vec<usize>, usize)>,
}

fn run_end(source: &[char], start: usize, max_len: usize, accept: impl Fn(char) -> bool) -> usize {
    let limit = source.len().min(start.saturating_add(max_len));
    (start..limit)
        .find(|&index| !accept(source[index]))
        .unwrap_or(limit)
}

fn backtick_run_end(source: &[char], start: usize) -> usize {
    run_end(source, start, source.len() - start, |ch| ch == '`')
}

fn starts_with_ignoring_ascii_case(word: &[char], prefix: &str) -> bool {
    let mut chars = word.iter();
    prefix.chars().all(|expected| {
        chars
            .next()
            .is_some_and(|ch| ch.eq_ignore_ascii_case(&expected))
    })
}

fn url_start(word: &[char]) -> Option<usize> {
    (0..word.len()).find(|&index| {
        let boundary = index == 0 || !word[index - 1].is_ascii_alphanumeric();
        boundary
            && AUTOMATIC_LINK_PREFIXES
                .iter()
                .any(|prefix| starts_with_ignoring_ascii_case(&word[index..], prefix))
    })
}

fn is_email_local(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '+' | '-')
}

fn email_start(word: &[char]) -> Option<usize> {
    let at = word.iter().position(|&ch| ch == '@')?;
    if at == 0 || !word[at..].contains(&'.') {
        return None;
    }
    let start = word[..at]
        .iter()
        .rposition(|&ch| !is_email_local(ch))
        .map_or(0, |index| index + 1);
    (start < at).then_some(start)
}

fn automatic_link_range(word: &[char]) -> Option<Range<usize>> {
    let start = [url_start(word), email_start(word)]
        .into_iter()
        .flatten()
        .min()?;
    let kept = word[start..]
        .iter()
        .rposition(|&ch| !TRAILING_LINK_PUNCTUATION.contains(ch))?;
    Some(start..start + kept + 1)
}

// The encoder leaves `_` and `&` raw inside the words remark-gfm links, since a backslash would
// land in the link text and target; here they stay text, never emphasis or a reference.
fn link_safe_positions(source: &[char]) -> Vec<bool> {
    let mut safe = vec![false; source.len()];
    let mut start = 0;
    while start < source.len() {
        if source[start].is_whitespace() {
            start += 1;
            continue;
        }
        let end = run_end(source, start, source.len() - start, |ch| {
            !ch.is_whitespace()
        });
        if let Some(range) = automatic_link_range(&source[start..end]) {
            let word = start + range.start..start + range.end;
            for (flag, &ch) in safe[word.clone()].iter_mut().zip(&source[word]) {
                *flag = matches!(ch, '_' | '&');
            }
        }
        start = end;
    }
    safe
}

impl CodeSpanCloser {
    // Closing runs are found in the raw text, where backslashes do not escape. Openers are met
    // left to right, so one cursor per run length keeps the whole scan linear.
    fn new(source: &[char]) -> Self {
        let mut runs: HashMap<usize, (Vec<usize>, usize)> = HashMap::new();
        let mut index = 0;
        while index < source.len() {
            if source[index] != '`' {
                index += 1;
                continue;
            }
            let end = backtick_run_end(source, index);
            runs.entry(end - index).or_default().0.push(index);
            index = end;
        }
        Self { runs }
    }

    fn closer(&mut self, after: usize, length: usize) -> Option<usize> {
        let (starts, cursor) = self.runs.get_mut(&length)?;
        while starts.get(*cursor).is_some_and(|&start| start < after) {
            *cursor += 1;
        }
        starts.get(*cursor).copied()
    }
}

// Same code points micromark (the editor's parser) replaces; whitespace controls show as a space.
fn is_replaced_reference_code(code: u32) -> bool {
    code < 0x09
        || code == 0x0b
        || (0x0e..0x20).contains(&code)
        || (0x7f..0xa0).contains(&code)
        || (0xd800..0xe000).contains(&code)
        || (0xfdd0..0xfdf0).contains(&code)
        || code % 0x1_0000 >= 0xfffe
        || code > 0x10_ffff
}

fn numeric_reference_char(code: u32) -> char {
    if matches!(code, 0x09 | 0x0a | 0x0c | 0x0d) {
        return ' ';
    }
    if is_replaced_reference_code(code) {
        return char::REPLACEMENT_CHARACTER;
    }
    char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER)
}

fn numeric_reference(source: &[char], start: usize) -> Option<(char, usize)> {
    let hex = matches!(source.get(start), Some('x' | 'X'));
    let digits_start = start + usize::from(hex);
    let (radix, max_digits) = if hex { (16, 6) } else { (10, 7) };
    let digits_end = run_end(source, digits_start, max_digits, |ch| ch.is_digit(radix));
    if digits_end == digits_start || source.get(digits_end) != Some(&';') {
        return None;
    }
    let digits: String = source[digits_start..digits_end].iter().collect();
    let code = u32::from_str_radix(&digits, radix).ok()?;
    Some((numeric_reference_char(code), digits_end + 1))
}

fn named_reference(source: &[char], start: usize) -> Option<(char, usize)> {
    let end = run_end(source, start, MAX_NAMED_REFERENCE_LENGTH, |ch| {
        ch.is_ascii_alphanumeric()
    });
    if end == start || source.get(end) != Some(&';') {
        return None;
    }
    let name: String = source[start..end].iter().collect();
    NAMED_CHARACTER_REFERENCES
        .iter()
        .find(|(known, _)| *known == name)
        .and_then(|&(_, code)| char::from_u32(code))
        .map(|ch| (ch, end + 1))
}

fn push_backslash(source: &[char], index: usize, units: &mut Vec<TitleUnit>) -> usize {
    match source.get(index + 1) {
        Some(&next) if next.is_ascii_punctuation() => {
            units.push(TitleUnit::escaped(next));
            index + 2
        }
        _ => {
            units.push(TitleUnit::literal_text('\\'));
            index + 1
        }
    }
}

fn push_reference(source: &[char], index: usize, units: &mut Vec<TitleUnit>) -> usize {
    let reference = if source.get(index + 1) == Some(&'#') {
        numeric_reference(source, index + 2)
    } else {
        named_reference(source, index + 1)
    };
    match reference {
        Some((ch, end)) => {
            units.push(TitleUnit::literal_text(ch));
            end
        }
        None => {
            units.push(TitleUnit::source('&'));
            index + 1
        }
    }
}

fn code_span_text(content: &[char]) -> &[char] {
    let padded =
        content.len() >= 2 && content.first() == Some(&' ') && content.last() == Some(&' ');
    if padded && content.iter().any(|&ch| ch != ' ') {
        &content[1..content.len() - 1]
    } else {
        content
    }
}

fn push_literal_text(units: &mut Vec<TitleUnit>, text: &[char]) {
    units.extend(text.iter().map(|&ch| TitleUnit::literal_text(ch)));
}

fn push_backticks(
    source: &[char],
    index: usize,
    code_spans: &mut CodeSpanCloser,
    units: &mut Vec<TitleUnit>,
) -> usize {
    let open_end = backtick_run_end(source, index);
    let length = open_end - index;
    let Some(close) = code_spans.closer(open_end, length) else {
        push_literal_text(units, &source[index..open_end]);
        return open_end;
    };
    push_literal_text(units, code_span_text(&source[open_end..close]));
    close + length
}

fn push_title_token(
    source: &[char],
    index: usize,
    code_spans: &mut CodeSpanCloser,
    units: &mut Vec<TitleUnit>,
) -> usize {
    match source[index] {
        '\\' => push_backslash(source, index, units),
        '&' => push_reference(source, index, units),
        '`' => push_backticks(source, index, code_spans, units),
        ch => {
            units.push(TitleUnit::source(ch));
            index + 1
        }
    }
}

fn literal_title_units(source: &[char]) -> Vec<TitleUnit> {
    let mut units = Vec::with_capacity(source.len());
    let mut code_spans = CodeSpanCloser::new(source);
    let link_safe = link_safe_positions(source);
    let mut index = 0;
    while index < source.len() {
        if link_safe[index] {
            units.push(TitleUnit::literal_text(source[index]));
            index += 1;
        } else {
            index = push_title_token(source, index, &mut code_spans, &mut units);
        }
    }
    units
}

fn next_positions(units: &[TitleUnit], is_target: impl Fn(TitleUnit) -> bool) -> Vec<usize> {
    let mut next = vec![units.len(); units.len() + 1];
    for index in (0..units.len()).rev() {
        next[index] = if is_target(units[index]) {
            index
        } else {
            next[index + 1]
        };
    }
    next
}

impl TitleSyntaxIndex {
    fn new(units: &[TitleUnit]) -> Self {
        Self {
            close_bracket: next_positions(units, |unit| unit.is_syntax(']')),
            raw_close_bracket: next_positions(units, |unit| unit.is_raw(']')),
            close_paren: next_positions(units, |unit| unit.is_syntax(')')),
            alias_pipe: next_positions(units, |unit| unit.is_raw('|')),
            tilde: next_positions(units, |unit| unit.is_syntax('~')),
        }
    }
}

fn syntax_at(units: &[TitleUnit], position: usize, end: usize, ch: char) -> bool {
    position < end && units[position].is_syntax(ch)
}

// Like the editor's `[[...]]` match, no raw `]` inside. A raw or table-escaped `\|` names the
// alias; a pipe from a character reference or code span is text.
fn wikilink_span(
    units: &[TitleUnit],
    index: &TitleSyntaxIndex,
    start: usize,
    end: usize,
) -> Option<TitleSpan> {
    if !syntax_at(units, start + 1, end, '[') {
        return None;
    }
    let inner = start + 2;
    let close = index.raw_close_bracket[inner];
    if close <= inner
        || !syntax_at(units, close, end, ']')
        || !syntax_at(units, close + 1, end, ']')
    {
        return None;
    }
    let pipe = index.alias_pipe[inner];
    let text_start = if pipe > inner && pipe + 1 < close {
        pipe + 1
    } else {
        inner
    };
    Some(TitleSpan {
        text: text_start..close,
        next: close + 2,
    })
}

fn link_span(
    units: &[TitleUnit],
    index: &TitleSyntaxIndex,
    start: usize,
    end: usize,
) -> Option<TitleSpan> {
    let label = start + 1;
    let label_end = index.close_bracket[label];
    if label_end <= label || !syntax_at(units, label_end + 1, end, '(') {
        return None;
    }
    let destination = label_end + 2;
    let destination_end = index.close_paren[destination];
    if destination_end <= destination || destination_end >= end {
        return None;
    }
    Some(TitleSpan {
        text: label..label_end,
        next: destination_end + 1,
    })
}

fn strikethrough_span(
    units: &[TitleUnit],
    index: &TitleSyntaxIndex,
    start: usize,
    end: usize,
) -> Option<TitleSpan> {
    if !syntax_at(units, start + 1, end, '~') {
        return None;
    }
    let content = start + 2;
    let close = index.tilde[content];
    if close <= content || !syntax_at(units, close + 1, end, '~') {
        return None;
    }
    if units[content].ch.is_whitespace() || units[close - 1].ch.is_whitespace() {
        return None;
    }
    Some(TitleSpan {
        text: content..close,
        next: close + 2,
    })
}

fn title_span_at(
    units: &[TitleUnit],
    index: &TitleSyntaxIndex,
    position: usize,
    end: usize,
) -> Option<TitleSpan> {
    let unit = units[position];
    if unit.origin != TitleUnitOrigin::Source {
        return None;
    }
    match unit.ch {
        '[' => wikilink_span(units, index, position, end)
            .or_else(|| link_span(units, index, position, end)),
        '~' => strikethrough_span(units, index, position, end),
        _ => None,
    }
}

fn push_underscore_run(
    units: &[TitleUnit],
    position: usize,
    range: &Range<usize>,
    text: &mut String,
) -> usize {
    let end = (position..range.end)
        .find(|&next| !units[next].is_syntax('_'))
        .unwrap_or(range.end);
    let before = position
        .checked_sub(1)
        .filter(|&previous| previous >= range.start)
        .map(|previous| units[previous].ch);
    let after = units[..range.end].get(end).map(|unit| unit.ch);
    if before.is_some_and(char::is_alphanumeric) && after.is_some_and(char::is_alphanumeric) {
        text.push_str(&"_".repeat(end - position));
    }
    end
}

fn push_plain_title_unit(
    units: &[TitleUnit],
    position: usize,
    range: &Range<usize>,
    text: &mut String,
) -> usize {
    let unit = units[position];
    if unit.origin != TitleUnitOrigin::Source {
        text.push(unit.ch);
        return position + 1;
    }
    match unit.ch {
        '*' => position + 1,
        '_' => push_underscore_run(units, position, range, text),
        ch => {
            text.push(ch);
            position + 1
        }
    }
}

// Spans nest at most three deep: a wikilink holds no raw `]`, a link label no syntax `]`, and
// strikethrough no syntax `~`.
fn render_title_units(
    units: &[TitleUnit],
    index: &TitleSyntaxIndex,
    range: Range<usize>,
    text: &mut String,
) {
    let mut position = range.start;
    while position < range.end {
        if let Some(span) = title_span_at(units, index, position, range.end) {
            render_title_units(units, index, span.text, text);
            position = span.next;
        } else {
            position = push_plain_title_unit(units, position, &range, text);
        }
    }
}

/// Plain display text for a title's inline Markdown; the caller trims it.
pub(super) fn title_text_from_markdown(markdown: &str) -> String {
    let source: Vec<char> = markdown.chars().collect();
    let units = literal_title_units(&source);
    let index = TitleSyntaxIndex::new(&units);
    let mut text = String::with_capacity(markdown.len());
    render_title_units(&units, &index, 0..units.len(), &mut text);
    text
}

#[cfg(test)]
#[path = "title_text_tests.rs"]
mod tests;
