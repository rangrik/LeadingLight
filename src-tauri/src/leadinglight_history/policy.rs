//! When the text a save replaces is worth keeping. Pure, so its table is tested directly.

use super::history_outcome::VersionReason;

pub(super) const CHECKPOINT_MS: u64 = 60_000;
pub(super) const DEDUPE_MS: u64 = 2 * 60 * 60 * 1000;
const BIG_BYTES: usize = 2 * 1024;

/// A listable version already kept at this location.
pub(super) struct Kept<'a> {
    pub(super) captured_at: u64,
    pub(super) length: u64,
    pub(super) sha256: &'a str,
}

/// What this process remembers about one location.
#[derive(Default)]
pub(super) struct Seen {
    pub(super) this_run: bool,
    pub(super) last_written: Option<String>,
}

/// Bytes removed or replaced between `before` and `after`, ignoring a shared start and end.
pub(super) fn removed_span(before: &[u8], after: &[u8]) -> usize {
    let prefix = before.iter().zip(after).take_while(|(a, b)| a == b).count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    before.len() - prefix - suffix
}

/// `None` means skip. `p` is the text on disk now, `n` the text about to replace it.
pub(super) fn decide(
    p: &[u8],
    p_sha: &str,
    n: &[u8],
    now: u64,
    kept: &[Kept<'_>],
    seen: &Seen,
) -> Option<VersionReason> {
    if p.is_empty() || p == n {
        return None;
    }
    let same = |version: &&Kept<'_>| version.length == p.len() as u64 && version.sha256 == p_sha;
    let newest = kept.iter().max_by_key(|version| version.captured_at);
    let recent = kept
        .iter()
        .filter(|version| now.saturating_sub(version.captured_at) < DEDUPE_MS);
    if newest.as_ref().is_some_and(same) || recent.clone().any(|version| same(&version)) {
        return None;
    }
    let Some(newest) = newest else {
        return Some(VersionReason::FirstSave);
    };
    if !seen.this_run {
        return Some(VersionReason::SessionStart);
    }
    if seen
        .last_written
        .as_deref()
        .is_some_and(|written| written != p_sha)
    {
        return Some(VersionReason::ChangedElsewhere);
    }
    let removed = removed_span(p, n);
    if removed >= BIG_BYTES || (removed > 0 && removed * 10 >= p.len() * 3) {
        return Some(VersionReason::BigChange);
    }
    (now.saturating_sub(newest.captured_at) >= CHECKPOINT_MS).then_some(VersionReason::Checkpoint)
}
