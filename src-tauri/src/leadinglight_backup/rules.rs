//! What a backup holds: one path rule shared by backup, inspection and restore, and the limits.

pub(super) const MAX_ENTRIES: usize = 100_000;
pub(super) const MAX_PATH_BYTES_TOTAL: usize = 16 << 20;
pub(super) const MAX_PATH_BYTES: usize = 1024;
pub(super) const MAX_DEPTH: usize = 64;
pub(super) const MAX_MANIFEST_BYTES: u64 = 64 << 20;
pub(super) const MAX_GAPS_KEPT: usize = 1000;
pub(super) const SAMPLE: usize = 5;
pub(super) const ATTEMPTS: usize = 3;
pub(super) const TRASH_COUNT_CAP: u64 = 10_000;
pub(super) const MAX_SAFE: u64 = (1 << 53) - 1;
pub(super) const MAX_NAME_BYTES: usize = 255;

#[cfg(test)]
thread_local! {
    /// Test seam: a smaller entry limit, so the bound is exercised without 100,000 files.
    pub(super) static ENTRY_CAP: std::cell::Cell<usize> = const { std::cell::Cell::new(MAX_ENTRIES) };
}

pub(super) fn max_entries() -> usize {
    #[cfg(test)]
    return ENTRY_CAP.with(std::cell::Cell::get);
    #[cfg(not(test))]
    MAX_ENTRIES
}

pub(super) const MANIFEST: &str = "leadinglight-backup.json";
pub(super) const WORKSPACE: &str = "workspace";
pub(super) const RESTORE_MARKER: &str = ".leadinglight-restore-unfinished";
pub(super) const STORE: &str = ".leadinglight";

/// Why a path cannot be stored or restored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PathFault {
    NotText,
    TooLong,
    TooDeep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Class {
    /// Pages, attachments and any other user file.
    User,
    /// A saved-version file in its exact stored shape.
    Version,
    /// Never copied: Git, caches, locks, staging, Trash and other store internals.
    Excluded,
}

/// One name: not empty, not `.` or `..`, and nothing another system reads as a separator,
/// drive, or terminator.
pub(super) fn segment_ok(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
}

/// A `/`-separated relative path that is safe to store and to restore anywhere.
pub(super) fn check_path(path: &str) -> Result<(), PathFault> {
    if path.len() > MAX_PATH_BYTES {
        return Err(PathFault::TooLong);
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() > MAX_DEPTH {
        return Err(PathFault::TooDeep);
    }
    if path.is_empty() || !segments.iter().all(|segment| segment_ok(segment)) {
        return Err(PathFault::NotText);
    }
    Ok(())
}

fn hex_of(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `<ms>-<sha16>-<tag6>`, the stored shape of a saved-version folder.
fn version_name(name: &str) -> bool {
    let mut parts = name.split('-');
    let (Some(time), Some(sha), Some(tag), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    (1..=16).contains(&time.len())
        && time.bytes().all(|b| b.is_ascii_digit())
        && hex_of(sha, 16)
        && hex_of(tag, 6)
}

fn same_name(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn starts_like(segment: &str, prefix: &str) -> bool {
    segment
        .get(..prefix.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
}

/// The class of a valid relative path. Forged manifest entries are judged by this same rule.
/// Reserved names match in any letter case, as a case-insensitive disk would resolve them.
pub(super) fn classify(path: &str) -> Class {
    let segments: Vec<&str> = path.split('/').collect();
    if segments
        .iter()
        .any(|segment| same_name(segment, ".git") || starts_like(segment, ".leadinglight-"))
    {
        return Class::Excluded;
    }
    let last = segments.last().copied().unwrap_or_default();
    if same_name(path, ".laputa-cache.json") || same_name(last, ".DS_Store") {
        return Class::Excluded;
    }
    if !same_name(segments[0], STORE) {
        return Class::User;
    }
    // Only the exact store spelling carries versions; any other spelling is excluded whole.
    if segments[0] != STORE {
        return Class::Excluded;
    }
    match segments.as_slice() {
        [_, "history", "versions", loc, "location.json"] if hex_of(loc, 32) => Class::Version,
        [_, "history", "versions", loc, name, "payload" | "version.json"]
            if hex_of(loc, 32) && version_name(name) =>
        {
            Class::Version
        }
        _ => Class::Excluded,
    }
}

/// A folder the walk never enters: excluded by rule, or the store, which history exports.
pub(super) fn skip_dir(path: &str) -> bool {
    same_name(path, STORE) || classify(path) == Class::Excluded
}

/// A restore folder name: one plain component the user typed.
pub(super) fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && segment_ok(name)
        && !name.starts_with('.')
        && name.trim() == name
}

/// A folder name derived from the workspace, safe on any disk.
pub(super) fn display_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    let mut name = String::new();
    for c in cleaned.chars() {
        if name.len() + c.len_utf8() > 120 {
            break;
        }
        name.push(c);
    }
    let name = name.trim_end().to_string();
    if name.is_empty() {
        "Workspace".to_string()
    } else {
        name
    }
}
