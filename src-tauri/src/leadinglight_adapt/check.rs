//! The contract's text rules and bounds (`ADAPT_LIMITS`, `checkSendArgs`, the reply reader), so
//! native refuses exactly what the UI checks before sending. Characters count UTF-16 code units, as
//! JavaScript's `String.length`; bytes are UTF-8.

use super::wire::{Attachment, Reply, RevisionBase, SendArgs, SendRefusal};

pub(crate) const REQUEST_BYTES: usize = 16 * 1024;
pub(crate) const ATTACHMENTS: usize = 8;
pub(crate) const ATTACHMENT_BYTES: usize = 128 * 1024;
/// Request, attachment texts and the included prior turns together; the guide is extra.
pub(crate) const PAYLOAD_BYTES: usize = 512 * 1024;
pub(crate) const LABEL_CHARS: usize = 120;
pub(crate) const INCLUDED_TURNS: usize = 16;
pub(crate) const MESSAGE_CHARS: usize = 600;
pub(crate) const CHOICES: usize = 3;
pub(crate) const CHOICE_CHARS: usize = 120;
pub(crate) const PACKAGE_BYTES: usize = 128 * 1024;
/// Amendment 5: UTF-8 bytes of an answer's Markdown text.
pub(crate) const ANSWER_BYTES: usize = 16 * 1024;
pub(crate) const TURNS_PER_CONVERSATION: usize = 50;
pub(crate) const CONVERSATIONS_PER_VAULT: usize = 50;

/// The contract's opaque token: 1 to 128 of `A-Z a-z 0-9 . _ : -`.
pub(crate) fn is_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// A lowercase hyphenated UUID shape, as `isTurnId`.
pub(crate) fn is_turn_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => matches!(byte, b'0'..=b'9' | b'a'..=b'f'),
        })
}

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// JavaScript's `trim` set, so blank means the same on both sides.
fn is_js_space(character: char) -> bool {
    matches!(
        character as u32,
        0x09..=0x0d | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff
    )
}

pub(crate) fn is_blank(text: &str) -> bool {
    text.chars().all(is_js_space)
}

/// Controls, line and paragraph separators, direction overrides and isolates. Prose allows tab and
/// newline.
pub(crate) fn is_control(character: char, prose: bool) -> bool {
    if prose && matches!(character, '\t' | '\n') {
        return false;
    }
    matches!(
        character as u32,
        0x00..=0x1f | 0x7f..=0x9f | 0x2028..=0x202e | 0x2066..=0x2069
    )
}

pub(crate) fn is_plain_prose(text: &str, max_chars: usize) -> bool {
    !is_blank(text)
        && utf16_len(text) <= max_chars
        && !text.chars().any(|character| is_control(character, true))
}

/// Prose of any length: not blank, tab and newline as the only controls. Bounds are the caller's.
fn is_prose_text(text: &str) -> bool {
    !is_blank(text) && !text.chars().any(|character| is_control(character, true))
}

pub(crate) fn is_plain_line(text: &str, max_chars: usize) -> bool {
    !is_blank(text)
        && utf16_len(text) <= max_chars
        && !text.chars().any(|character| is_control(character, false))
}

/// Text that crosses the boundary: not blank and no NUL. Rust strings hold no lone surrogates.
fn is_sendable(text: &str) -> bool {
    !is_blank(text) && !text.contains('\0')
}

fn attachment_shaped(attachment: &Attachment) -> bool {
    is_plain_line(&attachment.label, LABEL_CHARS) && is_sendable(&attachment.text)
}

/// `isRevisionBase`: a package id, its exact base, and the version active when it was attached,
/// which is `None` or a hash.
pub(crate) fn revision_fits(revision: &RevisionBase) -> bool {
    is_token(&revision.package_id)
        && is_sha256(&revision.base_sha256)
        && revision
            .expected_active_sha256
            .as_deref()
            .is_none_or(is_sha256)
}

/// `checkSendArgs`: `invalidRequest` for a broken argument, `tooLarge` for a bound, in that order.
/// The included turns' size is checked by the host, which holds their text.
pub(crate) fn check_send(args: &SendArgs) -> Result<(), SendRefusal> {
    let mut seen = std::collections::HashSet::new();
    let shaped = is_token(&args.visit_id)
        && is_token(&args.conversation_id)
        && is_turn_id(&args.turn_id)
        && is_sendable(&args.request)
        && args.attachments.len() <= ATTACHMENTS
        && args.attachments.iter().all(attachment_shaped)
        && args.include_turn_ids.len() <= INCLUDED_TURNS
        && args
            .include_turn_ids
            .iter()
            .all(|id| is_turn_id(id) && id != &args.turn_id && seen.insert(id.as_str()))
        && args.revision.as_ref().is_none_or(revision_fits);
    if !shaped {
        return Err(SendRefusal::InvalidRequest);
    }
    let attached: Vec<usize> = args
        .attachments
        .iter()
        .map(|item| item.text.len())
        .collect();
    if args.request.len() > REQUEST_BYTES || attached.iter().any(|bytes| *bytes > ATTACHMENT_BYTES)
    {
        return Err(SendRefusal::TooLarge);
    }
    if args.request.len() + attached.iter().sum::<usize>() > PAYLOAD_BYTES {
        return Err(SendRefusal::TooLarge);
    }
    Ok(())
}

/// Why a model answer cannot be kept, if it cannot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplyFault {
    Invalid,
    TooLarge,
}

/// The reader's rules for a stored reply (`parseAdaptReply`): plain prose and bounded sizes. An
/// answer's text is prose of at most `ANSWER_BYTES`, never interpreted.
pub(crate) fn check_reply(reply: &Reply) -> Result<(), ReplyFault> {
    let message = match reply {
        Reply::Candidate { message, .. }
        | Reply::Question { message, .. }
        | Reply::Unsupported { message, .. }
        | Reply::Answer { message, .. } => message,
    };
    prose(message)?;
    match reply {
        Reply::Candidate { package_text, .. } => {
            if package_text.len() > PACKAGE_BYTES {
                return Err(ReplyFault::TooLarge);
            }
            if is_blank(package_text) || package_text.contains('\0') {
                return Err(ReplyFault::Invalid);
            }
        }
        Reply::Question { choices, .. } => {
            if choices.len() > CHOICES {
                return Err(ReplyFault::Invalid);
            }
            for choice in choices {
                if utf16_len(choice) > CHOICE_CHARS {
                    return Err(ReplyFault::TooLarge);
                }
                if !is_plain_line(choice, CHOICE_CHARS) {
                    return Err(ReplyFault::Invalid);
                }
            }
        }
        Reply::Unsupported { alternative, .. } => {
            if let Some(alternative) = alternative {
                prose(alternative)?;
            }
        }
        Reply::Answer { answer, .. } => {
            if answer.len() > ANSWER_BYTES {
                return Err(ReplyFault::TooLarge);
            }
            if !is_prose_text(answer) {
                return Err(ReplyFault::Invalid);
            }
        }
    }
    Ok(())
}

fn prose(text: &str) -> Result<(), ReplyFault> {
    if utf16_len(text) > MESSAGE_CHARS {
        return Err(ReplyFault::TooLarge);
    }
    if is_plain_prose(text, MESSAGE_CHARS) {
        Ok(())
    } else {
        Err(ReplyFault::Invalid)
    }
}

/// The first line of a request, as a plain one-line title within `LABEL_CHARS`.
pub(crate) fn title_of(request: &str) -> String {
    let line = request
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut title = String::new();
    let mut units = 0;
    for character in line.chars() {
        let character = if character == '\t' { ' ' } else { character };
        if is_control(character, false) {
            continue;
        }
        units += character.len_utf16();
        if units > LABEL_CHARS {
            break;
        }
        title.push(character);
    }
    let trimmed = title.trim_matches(is_js_space).to_string();
    if is_blank(&trimmed) {
        String::new()
    } else {
        trimmed
    }
}
