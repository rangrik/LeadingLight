//! The completion manifest: written last by a backup, and untrusted input to inspection and
//! restore. Bounds are checked before parsing; no field grants access past the path rule.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::rules::{
    check_path, classify, max_entries, name_ok, Class, MAX_GAPS_KEPT, MAX_PATH_BYTES,
    MAX_PATH_BYTES_TOTAL, MAX_SAFE,
};
use super::{GapReason, Problem, Summary};

pub(super) const FORMAT: &str = "leadinglight-backup";
pub(super) const VERSION: u32 = 1;
const MAX_TEXT: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Status {
    Complete,
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FileEntry {
    pub(super) path: String,
    pub(super) bytes: u64,
    pub(super) sha256: String,
    pub(super) modified_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GapEntry {
    pub(super) path: String,
    pub(super) reason: GapReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    pub(super) format: String,
    pub(super) version: u32,
    pub(super) app_version: String,
    pub(super) created_at: String,
    pub(super) workspace_name: String,
    pub(super) status: Status,
    pub(super) files: Vec<FileEntry>,
    pub(super) gaps: Vec<GapEntry>,
    pub(super) gaps_total: u64,
    pub(super) versions_skipped: u64,
    pub(super) trash_items_not_included: u64,
    pub(super) total_files: u64,
    pub(super) total_bytes: u64,
}

/// Only the two fields needed to tell an unsupported version from a damaged file.
#[derive(Deserialize)]
struct Probe {
    format: Option<String>,
    version: Option<u64>,
}

fn sha_ok(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn time_ok(text: &str) -> bool {
    text.len() <= 64 && chrono::DateTime::parse_from_rfc3339(text).is_ok() && text.ends_with('Z')
}

/// Parses and checks manifest bytes already read within the size bound.
pub(super) fn parse(bytes: &[u8]) -> Result<Manifest, Summary<Problem>> {
    let mut problems = Summary::default();
    let probe: Probe = match serde_json::from_slice(bytes) {
        Ok(probe) => probe,
        Err(_) => {
            problems.add(None, Problem::ManifestInvalid);
            return Err(problems);
        }
    };
    if probe.format.as_deref() != Some(FORMAT) {
        problems.add(None, Problem::ManifestInvalid);
        return Err(problems);
    }
    if probe.version != Some(u64::from(VERSION)) {
        problems.add(None, Problem::UnsupportedVersion);
        return Err(problems);
    }
    let manifest: Manifest = match serde_json::from_slice(bytes) {
        Ok(manifest) => manifest,
        Err(_) => {
            problems.add(None, Problem::ManifestInvalid);
            return Err(problems);
        }
    };
    validate(&manifest, &mut problems);
    if problems.total == 0 {
        Ok(manifest)
    } else {
        Err(problems)
    }
}

fn validate(manifest: &Manifest, problems: &mut Summary<Problem>) {
    let invalid = |problems: &mut Summary<Problem>| problems.add(None, Problem::ManifestInvalid);
    if manifest.files.len() > max_entries()
        || manifest
            .files
            .iter()
            .map(|file| file.path.len())
            .sum::<usize>()
            > MAX_PATH_BYTES_TOTAL
    {
        problems.add(None, Problem::TooLarge);
        return;
    }
    let numbers = [
        manifest.gaps_total,
        manifest.versions_skipped,
        manifest.trash_items_not_included,
        manifest.total_files,
        manifest.total_bytes,
    ];
    let header_ok = manifest.app_version.len() <= MAX_TEXT
        && time_ok(&manifest.created_at)
        && name_ok(&manifest.workspace_name)
        && numbers.iter().all(|n| *n <= MAX_SAFE)
        && manifest.gaps.len() <= MAX_GAPS_KEPT
        && manifest.gaps.len() as u64 <= manifest.gaps_total
        && (manifest.gaps_total as usize > MAX_GAPS_KEPT
            || manifest.gaps.len() as u64 == manifest.gaps_total)
        && manifest
            .gaps
            .iter()
            .all(|gap| gap.path.len() <= MAX_PATH_BYTES)
        && (manifest.status == Status::Complete) == (manifest.gaps_total == 0)
        && manifest.total_files == manifest.files.len() as u64;
    if !header_ok {
        invalid(problems);
    }
    let mut total = 0u64;
    let mut seen = HashSet::with_capacity(manifest.files.len());
    for file in &manifest.files {
        total = total.saturating_add(file.bytes);
        if file.bytes > MAX_SAFE || file.modified_ms > MAX_SAFE || !sha_ok(&file.sha256) {
            problems.add(Some(file.path.clone()), Problem::ManifestInvalid);
        }
        if check_path(&file.path).is_err() || classify(&file.path) == Class::Excluded {
            problems.add(Some(file.path.clone()), Problem::BadPath);
        } else if !seen.insert(file.path.as_str()) {
            problems.add(Some(file.path.clone()), Problem::DuplicatePath);
        }
    }
    if total != manifest.total_bytes || total > MAX_SAFE {
        invalid(problems);
    }
    // A listed file that is also a folder of another listed file.
    for file in &manifest.files {
        let path = file.path.as_str();
        if path
            .match_indices('/')
            .any(|(at, _)| seen.contains(&path[..at]))
        {
            problems.add(Some(file.path.clone()), Problem::PathConflict);
        }
    }
}

/// The written form: compact JSON and a final newline.
pub(super) fn encode(manifest: &Manifest) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(manifest).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}
