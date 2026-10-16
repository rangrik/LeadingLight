//! Byte-preserving Markdown destination updates for a local page relocation.
//!
//! This module never reads the filesystem. Its callers must validate the native
//! paths and complete every preflight before changing a file. Ordinary page
//! wikilinks are handled by the existing rename code; only an exact, path-based
//! self-wikilink needs special treatment in the outgoing page.

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;
use std::path::{Component, Path};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Link,
    Image,
}

struct Destination {
    span: Range<usize>,
    value: String,
    kind: Kind,
    wiki: bool,
}

struct Context {
    vault: Vec<String>,
    source: Vec<String>,
    old: Vec<String>,
    new: Vec<String>,
    outgoing: bool,
}

/// Preserve the outgoing page's relative references and explicit self-links.
pub fn rebase_outgoing(
    content: &str,
    vault: &Path,
    old_note: &Path,
    new_note: &Path,
) -> Result<String, String> {
    transform(
        content,
        Context::new(vault, old_note, old_note, new_note, true)?,
    )
}

/// Retarget ordinary Markdown links in another page that identify `old_target`.
/// Page wikilinks are deliberately left for the existing native rename lane.
pub fn retarget_incoming(
    content: &str,
    vault: &Path,
    source_note: &Path,
    old_target: &Path,
    new_target: &Path,
) -> Result<String, String> {
    transform(
        content,
        Context::new(vault, source_note, old_target, new_target, false)?,
    )
}

impl Context {
    fn new(
        vault: &Path,
        source: &Path,
        old: &Path,
        new: &Path,
        outgoing: bool,
    ) -> Result<Self, String> {
        let context = Self {
            vault: native_segments(vault)?,
            source: native_segments(source)?,
            old: native_segments(old)?,
            new: native_segments(new)?,
            outgoing,
        };
        for path in [&context.source, &context.old, &context.new] {
            if !path.starts_with(&context.vault) || path.len() <= context.vault.len() {
                return Err("A page relocation path is outside the local vault.".into());
            }
        }
        Ok(context)
    }
}

fn native_segments(path: &Path) -> Result<Vec<String>, String> {
    if !path.is_absolute() {
        return Err("Page relocation requires absolute native paths.".into());
    }
    let mut result = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if result.len() > 1 {
                    result.pop();
                }
            }
            Component::RootDir => result.push(String::new()),
            Component::Normal(value) => result.push(
                value
                    .to_str()
                    .ok_or_else(|| "A relocation path is not valid UTF-8.".to_owned())?
                    .to_owned(),
            ),
            Component::Prefix(prefix) => result.push(
                prefix
                    .as_os_str()
                    .to_str()
                    .ok_or_else(|| "A relocation path is not valid UTF-8.".to_owned())?
                    .to_owned(),
            ),
        }
    }
    Ok(result)
}

fn transform(content: &str, context: Context) -> Result<String, String> {
    if context.old == context.new {
        return Ok(content.to_owned());
    }
    let mut changes: BTreeMap<(usize, usize), String> = BTreeMap::new();
    for destination in destinations(content)? {
        let raw = &content[destination.span.clone()];
        let replacement = if destination.wiki && destination.kind == Kind::Link {
            self_wikilink(&destination.value, &context)?
        } else {
            relocate_destination(raw, &destination, &context)?
        };
        let replacement = replacement.unwrap_or_else(|| raw.to_owned());
        let key = (destination.span.start, destination.span.end);
        if let Some(previous) = changes.insert(key, replacement.clone()) {
            if previous != replacement {
                return Err("A shared Markdown reference has different image and link meanings; use separate reference definitions before moving this page.".into());
            }
        }
    }
    let mut result = content.to_owned();
    let mut following_start = content.len();
    for ((start, end), replacement) in changes.into_iter().rev() {
        if end > following_start {
            return Err("Overlapping Markdown destinations cannot be relocated safely.".into());
        }
        result.replace_range(start..end, &replacement);
        following_start = start;
    }
    Ok(result)
}

fn body_start(content: &str) -> Result<usize, String> {
    let bom = if content.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    let mut lines = content[bom..].split_inclusive('\n');
    let Some(first) = lines.next() else {
        return Ok(bom);
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return Ok(bom);
    }
    let mut offset = bom + first.len();
    for line in lines {
        offset += line.len();
        if matches!(line.trim_end_matches(['\r', '\n']), "---" | "...") {
            return Ok(offset);
        }
    }
    Err("The page has unclosed YAML frontmatter; close it before moving the page.".into())
}

fn destinations(content: &str) -> Result<Vec<Destination>, String> {
    let offset = body_start(content)?;
    let body = &content[offset..];
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_WIKILINKS;
    let mut events = Parser::new_ext(body, options).into_offset_iter();
    let mut result = Vec::new();
    let mut used_definitions = BTreeSet::new();
    while let Some((event, range)) = events.next() {
        let (kind, link_type, value, id) = match event {
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                id,
                ..
            }) => (Kind::Link, link_type, dest_url.to_string(), id.to_string()),
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                id,
                ..
            }) => (Kind::Image, link_type, dest_url.to_string(), id.to_string()),
            Event::Html(html) | Event::InlineHtml(html)
                if has_html_destination_attribute(&html) =>
            {
                return Err("HTML link or image attributes cannot be relocated safely; use Markdown links and images before moving this page.".into());
            }
            _ => continue,
        };
        let wiki = matches!(link_type, LinkType::WikiLink { .. });
        let span = match link_type {
            LinkType::Inline => inline_destination(body, range)?,
            LinkType::Reference | LinkType::Collapsed | LinkType::Shortcut => {
                let Some(definition) = events.reference_definitions().get(&id) else {
                    return Err(
                        "A Markdown reference definition could not be located safely.".into(),
                    );
                };
                used_definitions.insert(definition.span.start);
                reference_destination(body, definition.span.clone())?
            }
            LinkType::WikiLink { .. } => wiki_destination(body, range)?,
            _ => continue,
        };
        result.push(Destination {
            span: (span.start + offset)..(span.end + offset),
            value,
            kind,
            wiki,
        });
    }
    for (_, definition) in events.reference_definitions().iter() {
        let value = definition.dest.trim();
        if !used_definitions.contains(&definition.span.start)
            && !value.is_empty()
            && !value.starts_with(['#', '?'])
            && !external(value)
        {
            return Err("An unused local Markdown reference has no known image or link meaning; remove it or use it explicitly before moving this page.".into());
        }
    }
    Ok(result)
}

fn has_html_destination_attribute(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    ["href", "src", "srcset", "poster"].iter().any(|name| {
        lower.match_indices(name).any(|(index, _)| {
            if index > 0 && !bytes[index - 1].is_ascii_whitespace() {
                return false;
            }
            let mut after = index + name.len();
            while after < bytes.len() && bytes[after].is_ascii_whitespace() {
                after += 1;
            }
            bytes.get(after) == Some(&b'=')
        })
    })
}

fn closing_label(text: &str, start: usize, end: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut index = start;
    while index < end {
        match bytes[index] {
            b'\\' => index += 2,
            b'`' => {
                let count = bytes[index..end]
                    .iter()
                    .take_while(|byte| **byte == b'`')
                    .count();
                let delimiter = "`".repeat(count);
                if let Some(close) = text[index + count..end].find(&delimiter) {
                    index += count + close + count;
                } else {
                    index += count;
                }
            }
            b'[' => {
                depth += 1;
                index += 1;
            }
            b']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    None
}

fn inline_destination(text: &str, range: Range<usize>) -> Result<Range<usize>, String> {
    let start = range.start + usize::from(text.as_bytes()[range.start] == b'!');
    let close = closing_label(text, start, range.end)
        .filter(|close| text.as_bytes().get(close + 1) == Some(&b'('))
        .ok_or_else(|| "A Markdown link label could not be located safely.".to_owned())?;
    scan_destination(text, close + 2, range.end)
}

fn reference_destination(text: &str, range: Range<usize>) -> Result<Range<usize>, String> {
    let start = range.start
        + text[range.clone()]
            .find('[')
            .ok_or_else(|| "A Markdown reference label could not be located safely.".to_owned())?;
    let close = closing_label(text, start, range.end)
        .filter(|close| text.as_bytes().get(close + 1) == Some(&b':'))
        .ok_or_else(|| "A Markdown reference label could not be located safely.".to_owned())?;
    scan_destination(text, close + 2, range.end)
}

fn scan_destination(text: &str, mut start: usize, end: usize) -> Result<Range<usize>, String> {
    let bytes = text.as_bytes();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    let angle = bytes.get(start) == Some(&b'<');
    start += usize::from(angle);
    let mut index = start;
    let mut depth = 0usize;
    while index < end {
        match bytes[index] {
            b'\\' if index + 1 < end => index += 2,
            b'>' if angle => return Ok(start..index),
            b'(' if !angle => {
                depth += 1;
                index += 1;
            }
            b')' if !angle && depth == 0 => return Ok(start..index),
            b')' if !angle => {
                depth -= 1;
                index += 1;
            }
            value if !angle && value.is_ascii_whitespace() => return Ok(start..index),
            _ => index += 1,
        }
    }
    if !angle {
        Ok(start..index)
    } else {
        Err("An angle-bracket Markdown destination could not be located safely.".into())
    }
}

fn wiki_destination(text: &str, range: Range<usize>) -> Result<Range<usize>, String> {
    let fragment = &text[range.clone()];
    let beginning = if fragment.starts_with("![[") { 3 } else { 2 };
    if !fragment.ends_with("]]") || fragment.len() < beginning + 2 {
        return Err("A wikilink destination could not be located safely.".into());
    }
    let end = fragment[beginning..fragment.len() - 2]
        .find('|')
        .map_or(fragment.len() - 2, |index| beginning + index);
    let target = &fragment[beginning..end];
    let leading = target.len() - target.trim_start().len();
    let trailing = target.trim_end().len();
    Ok((range.start + beginning + leading)..(range.start + beginning + trailing))
}

fn self_wikilink(value: &str, context: &Context) -> Result<Option<String>, String> {
    if !context.outgoing {
        return Ok(None);
    }
    let old = context.old[context.vault.len()..].join("/");
    let new = context.new[context.vault.len()..].join("/");
    let old_stem = note_stem(&old);
    let value = value.trim();
    let replacement = if value == old && (value.contains('/') || value.ends_with(".md")) {
        Some(new)
    } else if value == old_stem && value.contains('/') {
        Some(note_stem(&new).to_owned())
    } else {
        None
    };
    if replacement
        .as_ref()
        .is_some_and(|path| path.contains(['|', '[', ']', '\n', '\r']))
    {
        return Err(
            "The destination folder cannot be represented safely in this self-wikilink.".into(),
        );
    }
    Ok(replacement)
}

fn note_stem(path: &str) -> &str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".markdown") {
        &path[..path.len() - 9]
    } else if lower.ends_with(".md") {
        &path[..path.len() - 3]
    } else {
        path
    }
}

fn external(value: &str) -> bool {
    if value.starts_with("//") || value.starts_with("\\\\") {
        return true;
    }
    let Some(colon) = value.find(':') else {
        return false;
    };
    let scheme = &value[..colon];
    !scheme.is_empty()
        && scheme.as_bytes()[0].is_ascii_alphabetic()
        && scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+.-".contains(&byte))
}

fn portable_image(value: &str) -> bool {
    value.starts_with("attachments/")
        || value.starts_with("./attachments/")
        || value.starts_with("/attachments/")
}

fn is_image_path(value: &str) -> bool {
    let extension = value.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "avif" | "bmp" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp" | "tif" | "tiff"
    )
}

fn unescape_markdown(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek().is_some_and(char::is_ascii_punctuation) {
            if let Some(next) = chars.next() {
                result.push(next);
            }
        } else {
            result.push(ch);
        }
    }
    result
}

fn suffix_start(value: &str) -> usize {
    value.find(['?', '#']).unwrap_or(value.len())
}

fn decode_path(value: &str, image: bool) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let Some(pair) = bytes.get(index + 1..index + 3) else {
            return value.to_owned();
        };
        let hex = |byte: u8| (byte as char).to_digit(16).map(|number| number as u8);
        let (Some(high), Some(low)) = (hex(pair[0]), hex(pair[1])) else {
            return value.to_owned();
        };
        let byte = high * 16 + low;
        if image && b";/?:@&=+$,#".contains(&byte) {
            decoded.extend_from_slice(&bytes[index..index + 3]);
        } else {
            decoded.push(byte);
        }
        index += 3;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_owned())
}

fn resolve(base: &[String], path: &str) -> Vec<String> {
    let mut target = base.to_vec();
    for segment in path.split(['/', '\\']) {
        match segment {
            "" | "." => {}
            ".." => {
                if target.len() > 1 {
                    target.pop();
                }
            }
            _ => target.push(segment.to_owned()),
        }
    }
    target
}

fn relocate_destination(
    raw: &str,
    destination: &Destination,
    context: &Context,
) -> Result<Option<String>, String> {
    let image = destination.kind == Kind::Image;
    let value = destination.value.trim();
    if value.is_empty() || (!image && value.starts_with(['#', '?'])) || external(value) {
        return Ok(None);
    }
    if image && (portable_image(value) || value.starts_with('/')) {
        return Ok(None);
    }
    if destination.wiki
        && (!is_image_path(value) || !value.contains(['/', '\\']) && !value.starts_with('.'))
    {
        // Bare wiki image names are vault attachments, not note-relative paths.
        return Ok(None);
    }
    // The image preprocessor decodes the complete raw destination as a native
    // path. Unlike an ordinary anchor href, its # and ? are filename characters.
    let path_end = if image {
        value.len()
    } else {
        suffix_start(value)
    };
    let path = &value[..path_end];
    let rooted = path.starts_with('/');
    let decoded = decode_path(path, image);
    let is_note = note_stem(&decoded) != decoded;
    if rooted && !is_note {
        return Ok(None);
    }
    let source_parent = &context.source[..context.source.len() - 1];
    let base = if rooted {
        &context.vault[..]
    } else {
        source_parent
    };
    let mut target = resolve(base, &decoded);
    if target == context.old && (!image || is_note) {
        target = context.new.clone();
    } else if !context.outgoing {
        return Ok(None);
    }
    if !context.outgoing && image {
        return Ok(None);
    }
    let new_parent = if context.outgoing {
        &context.new[..context.new.len() - 1]
    } else {
        source_parent
    };
    if target == resolve(base, &decoded) && (rooted || new_parent == source_parent) {
        return Ok(None);
    }
    let unescaped = unescape_markdown(raw);
    if unescaped != value || image && raw != value {
        return Err("A local Markdown destination uses escaping or character entities that cannot be relocated safely; use a percent-encoded destination first.".into());
    }
    let raw_path_end = if image { raw.len() } else { suffix_start(raw) };
    let raw_path = &raw[..raw_path_end];
    let suffix = &raw[raw_path_end..];
    let relative = if rooted {
        if !target.starts_with(&context.vault) {
            return Err("A vault-root link escaped the local vault.".into());
        }
        format!(
            "/{}",
            spell_segments(&target[context.vault.len()..], raw_path, image)
        )
    } else {
        let common = new_parent
            .iter()
            .zip(target.iter())
            .take_while(|(left, right)| left == right)
            .count();
        if common == 0 {
            return Err("A local destination is on a different filesystem root.".into());
        }
        let mut parts = vec!["..".to_owned(); new_parent.len() - common];
        parts.extend_from_slice(&target[common..]);
        let spelled = spell_segments(&parts, raw_path, image);
        let relative = if parts.first().is_some_and(|first| first == "..") {
            spelled
        } else {
            format!("./{spelled}")
        };
        // ./attachments is a special vault-root image form, not an ordinary
        // relative path. An extra dot preserves the source-relative meaning.
        if image && portable_image(&relative) {
            format!("./{relative}")
        } else {
            relative
        }
    };
    Ok(Some(format!("{relative}{suffix}")))
}

fn spell_segments(parts: &[String], raw_path: &str, image: bool) -> String {
    let raw_parts: Vec<_> = raw_path.split('/').collect();
    let mut suffix_count = 0;
    for (part, raw) in parts.iter().rev().zip(raw_parts.iter().rev()) {
        if decode_path(&unescape_markdown(raw), image) != *part {
            break;
        }
        suffix_count += 1;
    }
    parts
        .iter()
        .enumerate()
        .map(|(index, part)| {
            if index >= parts.len() - suffix_count {
                raw_parts[raw_parts.len() - (parts.len() - index)].to_owned()
            } else {
                encode_segment(part, image)
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_segment(value: &str, image: bool) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        // decodeURI intentionally retains escapes for its reserved set. Keeping
        // those characters literal is necessary to reach the original image's
        // native filename; convertFileSrc subsequently encodes the asset URL.
        let image_reserved = image && ";/?:@&=+$,#".contains(ch);
        if !image_reserved
            && ch.is_ascii()
            && (ch.is_ascii_control()
                || ch.is_ascii_whitespace()
                || "%#?[]()<>\\|`\"'&:".contains(ch))
        {
            result.push_str(&format!("%{:02X}", ch as u8));
        } else {
            result.push(ch);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{rebase_outgoing, retarget_incoming};
    use std::path::Path;

    fn outgoing(content: &str) -> Result<String, String> {
        rebase_outgoing(
            content,
            Path::new("/vault"),
            Path::new("/vault/drafts/page.md"),
            Path::new("/vault/filed/page.md"),
        )
    }

    fn incoming(content: &str) -> Result<String, String> {
        retarget_incoming(
            content,
            Path::new("/vault"),
            Path::new("/vault/reference.md"),
            Path::new("/vault/drafts/page.md"),
            Path::new("/vault/filed/page.md"),
        )
    }

    #[test]
    fn leadinglight_relocation_rebases_only_destinations() {
        let source = "# Keep spacing  \r\n\r\n![Nearby](./image.png \"caption\")\r\n[Reference](./reference.md)\r\n";
        let expected = "# Keep spacing  \r\n\r\n![Nearby](../drafts/image.png \"caption\")\r\n[Reference](../drafts/reference.md)\r\n";
        assert_eq!(outgoing(source).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_preserves_portable_images_and_remote_targets() {
        let source = "![a](attachments/a.png) ![b](./attachments/b.png) ![c](/attachments/c.png)\n![d](/tmp/d.png) ![e](https://example.invalid/e.png)\n[remote](mailto:a@example.invalid) [anchor](#Here) [query](?view=1) [absolute](/assets/file.pdf)";
        assert_eq!(outgoing(source).unwrap(), source);
    }

    #[test]
    fn leadinglight_relocation_preserves_code_frontmatter_and_html() {
        let source = "---\nstarting_text: '[Template](./template.md)'\n---\n`[inline](./code.md)`\n\n```md\n![fenced](./code.png)\n```\n\n    [indented](./code.md)\n\n<!-- [comment](./comment.md) -->\n\n[real](./reference.md)\n";
        assert_eq!(
            outgoing(source).unwrap(),
            source.replace("[real](./reference.md)", "[real](../drafts/reference.md)")
        );
    }

    #[test]
    fn leadinglight_relocation_retains_angles_escapes_unicode_and_suffixes() {
        let source = "[One](<./naïve%20name.md?mode=1#Résumé> 'Title')\n[Two](./a\\(b\\).md#x)\n![Three](<./图片%20one.png>)";
        let expected = "[One](<../drafts/naïve%20name.md?mode=1#Résumé> 'Title')\n[Two](../drafts/a\\(b\\).md#x)\n![Three](<../drafts/图片%20one.png>)";
        assert_eq!(outgoing(source).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_preserves_nested_labels_and_parentheses() {
        let source =
            "[A `]` and [nested] label](./a(b).md \"Title\")\n[![icon](./icon.png)](./target.md)";
        let expected = "[A `]` and [nested] label](../drafts/a(b).md \"Title\")\n[![icon](../drafts/icon.png)](../drafts/target.md)";
        assert_eq!(outgoing(source).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_updates_used_reference_definitions_once() {
        let source = "[First][Doc] [doc][] [doc]\n![Picture][photo]\n\n[doc]: <./reference.md>\n  \"Keep title\"\n[photo]: ./image.png 'Caption'\n[unused]: https://example.invalid/unused.md\n";
        let expected = "[First][Doc] [doc][] [doc]\n![Picture][photo]\n\n[doc]: <../drafts/reference.md>\n  \"Keep title\"\n[photo]: ../drafts/image.png 'Caption'\n[unused]: https://example.invalid/unused.md\n";
        assert_eq!(outgoing(source).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_handles_unicode_reference_label_folding() {
        let source = "[One][STRASSE]\n\n[Straße]: ./reference.md\n";
        assert_eq!(
            outgoing(source).unwrap(),
            source.replace("./reference.md", "../drafts/reference.md")
        );
    }

    #[test]
    fn leadinglight_relocation_rejects_conflicting_shared_definition() {
        for source in [
            "![Image][shared] [Link][shared]\n\n[shared]: attachments/a.png\n",
            "[Link][shared] ![Image][shared]\n\n[shared]: attachments/a.png\n",
        ] {
            assert!(outgoing(source)
                .unwrap_err()
                .contains("shared Markdown reference"));
        }
    }

    #[test]
    fn leadinglight_relocation_supports_same_meaning_shared_definition() {
        let source = "![Image][same] [Link][same]\n\n[same]: ./image.png\n";
        assert_eq!(
            outgoing(source).unwrap(),
            source.replace("./image.png", "../drafts/image.png")
        );
    }

    #[test]
    fn leadinglight_relocation_retargets_self_and_incoming_exact_note_paths() {
        let source = "[Self](./page.md#title) [Root](/drafts/page.md?x=1) [Other](./other.md)\n[[drafts/page|This page]] [[Page title]]";
        let expected = "[Self](./page.md#title) [Root](/filed/page.md?x=1) [Other](../drafts/other.md)\n[[filed/page|This page]] [[Page title]]";
        assert_eq!(outgoing(source).unwrap(), expected);
        let reference = "[Moving](drafts/page.md#Title) [Root](/drafts/page.md) [Other](drafts/page-two.md) [[drafts/page]]";
        let expected = "[Moving](./filed/page.md#Title) [Root](/filed/page.md) [Other](drafts/page-two.md) [[drafts/page]]";
        assert_eq!(incoming(reference).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_retargets_encoded_note_paths_without_decoding_suffix() {
        let source = "[Moving](drafts%2Fpage.md?next=%2Fstay#Part%20one)";
        assert_eq!(
            incoming(source).unwrap(),
            "[Moving](./filed/page.md?next=%2Fstay#Part%20one)"
        );
    }

    #[test]
    fn leadinglight_relocation_keeps_image_reserved_percent_encoding() {
        assert_eq!(
            outgoing("![x](./image%2Fname%20one.png)").unwrap(),
            "![x](../drafts/image%2Fname%20one.png)"
        );
        assert_eq!(
            outgoing("![x](./image.png?size=1#fragment)").unwrap(),
            "![x](../drafts/image.png?size=1#fragment)"
        );
    }

    #[test]
    fn leadinglight_relocation_keeps_wiki_image_label_and_attachment_identity() {
        let source = "![[ ./image.png | 300 ]] ![[photo.png]] ![[attachments/a.png]] ![[nested/b.png|B]] [[drafts/page|Alias]]";
        let expected = "![[ ../drafts/image.png | 300 ]] ![[photo.png]] ![[attachments/a.png]] ![[../drafts/nested/b.png|B]] [[filed/page|Alias]]";
        assert_eq!(outgoing(source).unwrap(), expected);
    }

    #[test]
    fn leadinglight_relocation_does_not_make_local_image_portable_accidentally() {
        let result = rebase_outgoing(
            "![x](../attachments/image.png)",
            Path::new("/vault"),
            Path::new("/vault/nested/drafts/page.md"),
            Path::new("/vault/nested/page.md"),
        )
        .unwrap();
        assert_eq!(result, "![x](././attachments/image.png)");
    }

    #[test]
    fn leadinglight_relocation_encodes_new_directory_characters() {
        let result = retarget_incoming(
            "[Move](drafts/page.md)",
            Path::new("/vault"),
            Path::new("/vault/reference.md"),
            Path::new("/vault/drafts/page.md"),
            Path::new("/vault/My #1 (notes)/page.md"),
        )
        .unwrap();
        assert_eq!(result, "[Move](./My%20%231%20%28notes%29/page.md)");
    }

    #[test]
    fn leadinglight_relocation_rejects_ambiguous_local_image_escaping_and_entities() {
        assert!(outgoing("![x](./a\\(b\\).png)")
            .unwrap_err()
            .contains("escaping"));
        assert!(outgoing("[x](./a&amp;b.md)")
            .unwrap_err()
            .contains("character entities"));
        assert_eq!(
            outgoing("[remote](https://example.invalid?a=1&amp;b=2)").unwrap(),
            "[remote](https://example.invalid?a=1&amp;b=2)"
        );
    }

    #[test]
    fn leadinglight_relocation_rejects_unclosed_frontmatter_and_outside_paths() {
        assert!(outgoing("---\nstarting_text: '[x](./x.md)'\n")
            .unwrap_err()
            .contains("unclosed YAML"));
        assert!(rebase_outgoing(
            "[x](./x.md)",
            Path::new("/vault"),
            Path::new("/other/page.md"),
            Path::new("/vault/filed/page.md")
        )
        .is_err());
    }

    #[test]
    fn leadinglight_relocation_noop_and_unrelated_incoming_preserve_all_bytes() {
        let content = "[x](./unrelated.md)\n![image](./a.png)\n";
        assert_eq!(incoming(content).unwrap(), content);
        assert_eq!(
            rebase_outgoing(
                content,
                Path::new("/vault"),
                Path::new("/vault/page.md"),
                Path::new("/vault/page.md")
            )
            .unwrap(),
            content
        );
    }

    #[test]
    fn leadinglight_relocation_refuses_unused_local_definitions() {
        for source in [
            "[unused]: ./neighbor.md\n",
            "[unused]: attachments/photo.png\n",
        ] {
            assert!(outgoing(source)
                .unwrap_err()
                .contains("unused local Markdown reference"));
            assert!(incoming(source)
                .unwrap_err()
                .contains("unused local Markdown reference"));
        }
    }

    #[test]
    fn leadinglight_relocation_refuses_html_attributes_but_not_code_examples() {
        for source in [
            "<a href='./neighbor.md'>Neighbor</a>",
            "<img SRC = './photo.png'>",
            "<video poster=\"./poster.png\"></video>",
        ] {
            assert!(outgoing(source).unwrap_err().contains("HTML link or image"));
            assert!(incoming(source).unwrap_err().contains("HTML link or image"));
        }
        let code =
            "`<img src='./example.png'>`\n\n```html\n<a href='./neighbor.md'>Example</a>\n```\n";
        assert_eq!(outgoing(code).unwrap(), code);
    }

    #[test]
    fn leadinglight_relocation_image_reserved_directory_identity() {
        for directory in ["drafts#1", "drafts?1", "drafts&1", "drafts:1"] {
            let old_note = Path::new("/vault").join(directory).join("page.md");
            let new_note = Path::new("/vault/filed/page.md");
            let changed = rebase_outgoing(
                "![x](./photo.png)",
                Path::new("/vault"),
                &old_note,
                new_note,
            )
            .unwrap();
            let destination = changed
                .strip_prefix("![x](")
                .unwrap()
                .strip_suffix(')')
                .unwrap();
            // vaultImages.ts decodes the complete raw image destination with
            // decodeURI, then appends its path segments to the new directory.
            let resolved = super::resolve(
                &super::native_segments(new_note.parent().unwrap()).unwrap(),
                &super::decode_path(destination, true),
            );
            let original_image = old_note.parent().unwrap().join("photo.png");
            assert_eq!(
                resolved,
                super::native_segments(&original_image).unwrap(),
                "directory: {directory}"
            );
        }
    }

    #[test]
    fn leadinglight_relocation_images_resolve_the_entire_raw_destination() {
        let old_note = Path::new("/vault/drafts/page.md");
        let new_note = Path::new("/vault/filed/page.md");
        for original in [
            "#photo.png",
            "?photo.png",
            "./photo.png?size=1#fragment",
            "./dir#1/photo.png",
            "../images?set=one/photo.png",
        ] {
            let source = format!("![x]({original})");
            let changed =
                rebase_outgoing(&source, Path::new("/vault"), old_note, new_note).unwrap();
            let destination = changed
                .strip_prefix("![x](")
                .unwrap()
                .strip_suffix(')')
                .unwrap();
            let resolved = super::resolve(
                &super::native_segments(new_note.parent().unwrap()).unwrap(),
                &super::decode_path(destination, true),
            );
            let original_target = super::resolve(
                &super::native_segments(old_note.parent().unwrap()).unwrap(),
                &super::decode_path(original, true),
            );
            assert_eq!(resolved, original_target, "image destination: {original}");
        }
    }
}
