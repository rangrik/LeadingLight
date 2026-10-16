//! The Favorite transaction: changes only `_favorite` and `_favorite_index`, then publishes a
//! complete staged copy in one step. Every outcome says truthfully what is on disk.

use std::borrow::Cow;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use serde_yaml::{Mapping, Value};

use crate::vault::atomic_replace::{self, PublishError};

/// Staging and kept recovery folders sit beside the page under this name prefix.
pub(crate) const STAGING_PREFIX: &str = ".leadinglight-";

const KEYS: [&str; 2] = ["_favorite", "_favorite_index"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FavoriteState {
    On(u32),
    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefusalReason {
    Missing,
    Link,
    ChangedOnDisk,
    InvalidFrontmatter,
    OutsideVault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    Stage,
    Publish,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FavoriteWriteOutcome {
    /// The file now holds `content`; `written` is false when it already did.
    Committed {
        content: String,
        written: bool,
        durable: bool,
    },
    Refused {
        reason: RefusalReason,
    },
    /// Nothing was published and the original is proven unchanged.
    Failed {
        reason: FailureReason,
    },
    #[serde(rename_all = "camelCase")]
    Uncertain {
        original_at: Option<String>,
        staged_at: Option<String>,
    },
}

impl FavoriteWriteOutcome {
    pub fn refused(reason: RefusalReason) -> Self {
        Self::Refused { reason }
    }
}

type Line<'a> = (Cow<'a, str>, &'static str);

struct Block<'a> {
    head: Cow<'a, str>,
    lines: Vec<Line<'a>>,
    tail: Cow<'a, str>,
    line_ending: &'static str,
}

/// The block to prepend when a page has none.
fn new_block(content: &str) -> Block<'_> {
    Block {
        head: "---\n".into(),
        lines: Vec::new(),
        tail: format!("---\n{content}").into(),
        line_ending: "\n",
    }
}

fn is_delimiter(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|rest| rest.chars().all(|c| c == ' ' || c == '\t'))
}

fn line_break(rest: &str) -> Option<&'static str> {
    ["\r\n", "\n", "\r"]
        .into_iter()
        .find(|eol| rest.starts_with(eol))
}

/// Same split as the editor's: `None` without a block, an error when it never closes.
fn split_block(content: &str) -> Result<Option<Block<'_>>, String> {
    let line_end = |start: usize| {
        content[start..]
            .find(['\n', '\r'])
            .map_or(content.len(), |i| start + i)
    };
    let opening_end = line_end(0);
    let Some(line_ending) = line_break(&content[opening_end..]) else {
        return Ok(None);
    };
    if !is_delimiter(&content[..opening_end]) {
        return Ok(None);
    }
    let body_start = opening_end + line_ending.len();
    let mut lines = Vec::new();
    let mut start = body_start;
    while start < content.len() {
        let end = line_end(start);
        let text = &content[start..end];
        if is_delimiter(text) {
            let head = content[..body_start].into();
            let tail = content[start..].into();
            return Ok(Some(Block {
                head,
                lines,
                tail,
                line_ending,
            }));
        }
        let Some(eol) = line_break(&content[end..]) else {
            break;
        };
        lines.push((text.into(), eol));
        start = end + eol.len();
    }
    Err("the frontmatter block is not closed".into())
}

fn text_of(lines: &[Line]) -> String {
    lines
        .iter()
        .map(|(text, end)| format!("{text}{end}"))
        .collect()
}

/// The block as a mapping, empty when blank; an error unless it is one valid mapping.
fn metadata_of(lines: &[Line]) -> Result<Mapping, String> {
    match serde_yaml::from_str::<Value>(&text_of(lines)).map_err(|error| error.to_string())? {
        Value::Null => Ok(Mapping::new()),
        Value::Mapping(mapping) => Ok(mapping),
        _ => Err("the frontmatter is not a mapping".into()),
    }
}

fn has_state(data: &Mapping, state: FavoriteState) -> bool {
    match state {
        FavoriteState::Off => KEYS.iter().all(|key| !data.contains_key(*key)),
        FavoriteState::On(index) => {
            data.get("_favorite") == Some(&Value::Bool(true))
                && data.get("_favorite_index").and_then(Value::as_u64) == Some(u64::from(index))
        }
    }
}

fn without_keys(mut data: Mapping) -> Mapping {
    for key in KEYS {
        data.remove(key);
    }
    data
}

/// `key:` at the very start of a line, bare or quoted.
fn starts_key(line: &str, key: &str) -> bool {
    let after = ["", "\"", "'"].into_iter().find_map(|quote| {
        line.strip_prefix(quote)?
            .strip_prefix(key)?
            .strip_prefix(quote)
    });
    after.is_some_and(|rest| {
        let value = rest.trim_start_matches([' ', '\t']).strip_prefix(':');
        value.is_some_and(|value| value.is_empty() || value.starts_with([' ', '\t']))
    })
}

fn is_blank(line: &str) -> bool {
    line.chars().all(|c| c == ' ' || c == '\t')
}

fn is_comment(line: &str) -> bool {
    line.trim_start_matches([' ', '\t']).starts_with('#')
}

/// A value goes on over indented, blank and indentless list lines.
fn continues_value(line: &str) -> bool {
    let dash = line.strip_prefix('-');
    line.is_empty()
        || line.starts_with([' ', '\t'])
        || dash.is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\t']))
}

/// Lines `start..end` of a top-level key and its value, without trailing blank or comment lines.
fn key_span(lines: &[Line], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|(text, _)| starts_key(text, key))?;
    let mut end = start + 1;
    while end < lines.len() && continues_value(&lines[end].0) {
        end += 1;
    }
    while end > start + 1 && (is_blank(&lines[end - 1].0) || is_comment(&lines[end - 1].0)) {
        end -= 1;
    }
    Some((start, end))
}

/// `None` when a comment sits inside a Favorite value, since replacing the value would drop it.
fn patch_lines<'a>(
    lines: &[Line<'a>],
    state: FavoriteState,
    line_ending: &'static str,
) -> Option<Vec<Line<'a>>> {
    let values = match state {
        FavoriteState::On(index) => vec![String::from("true"), index.to_string()],
        FavoriteState::Off => Vec::new(),
    };
    let entry = |key: usize, end: &'static str| -> Line<'a> {
        (format!("{}: {}", KEYS[key], values[key]).into(), end)
    };
    let spans: Vec<_> = KEYS.iter().map(|key| key_span(lines, key)).collect();
    let mut found: Vec<_> = spans
        .iter()
        .enumerate()
        .filter_map(|(key, span)| span.map(|(start, end)| (start, end, key)))
        .collect();
    found.sort_unstable();
    let comment_inside = found.iter().any(|&(start, end, _)| {
        lines[start + 1..end]
            .iter()
            .any(|(text, _)| is_comment(text))
    });
    if comment_inside {
        return None;
    }
    let mut next = Vec::new();
    let mut index = 0;
    for (start, end, key) in found {
        next.extend_from_slice(&lines[index..start]);
        if !values.is_empty() {
            next.push(entry(key, lines[end - 1].1));
        }
        index = end;
    }
    next.extend_from_slice(&lines[index..]);
    if !values.is_empty() {
        let missing = spans.iter().enumerate().filter(|(_, span)| span.is_none());
        next.extend(missing.map(|(key, _)| entry(key, line_ending)));
    }
    Some(next)
}

/// Changes only the two keys and keeps every other byte; `None` when the page already has them.
/// An error when the block is not one valid mapping, or a reparse shows anything else would change.
pub fn apply_favorite_content(
    content: &str,
    state: FavoriteState,
) -> Result<Option<String>, String> {
    let block = split_block(content)?.unwrap_or_else(|| new_block(content));
    let before = metadata_of(&block.lines)?;
    if has_state(&before, state) {
        return Ok(None);
    }
    let lines = patch_lines(&block.lines, state, block.line_ending)
        .ok_or("a comment sits inside a Favorite value")?;
    let after = metadata_of(&lines)?;
    if !has_state(&after, state) || without_keys(after) != without_keys(before) {
        return Err("the Favorite change would alter other metadata".into());
    }
    Ok(Some(format!(
        "{}{}{}",
        block.head,
        text_of(&lines),
        block.tail
    )))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    len: u64,
    modified: Option<SystemTime>,
}

fn identity(meta: &fs::Metadata) -> FileIdentity {
    #[cfg(unix)]
    let (device, inode) = {
        use std::os::unix::fs::MetadataExt;
        (meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let (device, inode) = (0, 0);
    FileIdentity {
        device,
        inode,
        len: meta.len(),
        modified: meta.modified().ok(),
    }
}

fn link_count(meta: &fs::Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.nlink()
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        1
    }
}

/// A single-link regular file at `path`, or the refusal that applies.
fn plain_file(path: &Path) -> Result<fs::Metadata, RefusalReason> {
    let meta = fs::symlink_metadata(path).map_err(|_| RefusalReason::Missing)?;
    if meta.file_type().is_symlink() || link_count(&meta) > 1 {
        return Err(RefusalReason::Link);
    }
    if !meta.is_file() {
        return Err(RefusalReason::Missing);
    }
    Ok(meta)
}

/// The refusal for a page that is gone, linked or changed since it was read.
fn recheck(path: &Path, expected: &FileIdentity) -> Result<(), RefusalReason> {
    let meta = plain_file(path)?;
    if identity(&meta) == *expected {
        Ok(())
    } else {
        Err(RefusalReason::ChangedOnDisk)
    }
}

fn proven_unchanged(path: &Path, expected: &FileIdentity, bytes: &[u8]) -> bool {
    recheck(path, expected).is_ok() && fs::read(path).is_ok_and(|current| current == bytes)
}

pub struct Prepared {
    original: PathBuf,
    identity: FileIdentity,
    original_bytes: Vec<u8>,
    content: String,
    staging: tempfile::TempDir,
    staged: PathBuf,
}

pub enum Step {
    Done(FavoriteWriteOutcome),
    Ready(Prepared),
}

const STAGE_FAILED: FavoriteWriteOutcome = FavoriteWriteOutcome::Failed {
    reason: FailureReason::Stage,
};

pub fn prepare(path: &Path, state: FavoriteState) -> Step {
    if let Err(reason) = plain_file(path) {
        return Step::Done(FavoriteWriteOutcome::refused(reason));
    }
    let Ok((original_bytes, identity)) = read_with_identity(path) else {
        return Step::Done(STAGE_FAILED);
    };
    let invalid = || {
        Step::Done(FavoriteWriteOutcome::refused(
            RefusalReason::InvalidFrontmatter,
        ))
    };
    let Ok(text) = String::from_utf8(original_bytes.clone()) else {
        return invalid();
    };
    let content = match apply_favorite_content(&text, state) {
        Err(_) => return invalid(),
        Ok(None) => {
            return Step::Done(FavoriteWriteOutcome::Committed {
                content: text,
                written: false,
                durable: true,
            })
        }
        Ok(Some(content)) => content,
    };
    match stage(path, &content) {
        Ok((staging, staged)) => Step::Ready(Prepared {
            original: path.to_path_buf(),
            identity,
            original_bytes,
            content,
            staging,
            staged,
        }),
        Err(_) => Step::Done(STAGE_FAILED),
    }
}

fn read_with_identity(path: &Path) -> std::io::Result<(Vec<u8>, FileIdentity)> {
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok((bytes, identity(&file.metadata()?)))
}

/// A uniquely named sibling folder keeps the staged copy on the original's volume.
fn stage(path: &Path, content: &str) -> std::io::Result<(tempfile::TempDir, PathBuf)> {
    let parent = path.parent().ok_or(std::io::ErrorKind::NotFound)?;
    let name = path.file_name().ok_or(std::io::ErrorKind::NotFound)?;
    let staging = tempfile::Builder::new()
        .prefix(STAGING_PREFIX)
        .tempdir_in(parent)?;
    // Written before any page text, so Git skips the copy even under a parent `!` rule.
    fs::write(staging.path().join(".gitignore"), "*\n")?;
    let staged = staging.path().join(name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)?;
    file.write_all(content.as_bytes())?;
    file.set_permissions(fs::metadata(path)?.permissions())?;
    file.sync_all()?;
    Ok((staging, staged))
}

pub trait Platform {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError>;
    fn sync_dir(&self, dir: &Path) -> std::io::Result<()>;
}

pub struct NativePlatform;

impl Platform for NativePlatform {
    fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
        atomic_replace::replace_item(original, staged)
    }

    fn sync_dir(&self, dir: &Path) -> std::io::Result<()> {
        atomic_replace::sync_dir(dir)
    }
}

fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// The recheck is not a compare-and-swap: an outside writer can still act before the publish,
/// and the macOS publish does not refuse a page removed in that gap.
pub fn commit(prepared: Prepared, platform: &impl Platform) -> FavoriteWriteOutcome {
    let Prepared {
        original,
        identity,
        original_bytes,
        content,
        staging,
        staged,
    } = prepared;
    if let Err(reason) = recheck(&original, &identity) {
        return FavoriteWriteOutcome::refused(reason);
    }
    let published = platform.publish(&original, &staged);
    if let Err(error) = &published {
        log::warn!(
            "Favorite publish failed for {}: {}",
            original.display(),
            error.message
        );
    }
    match published {
        Ok(resulting) if same_path(&resulting, &original) => {
            let durable = original
                .parent()
                .is_some_and(|dir| platform.sync_dir(dir).is_ok());
            drop(staging);
            FavoriteWriteOutcome::Committed {
                content,
                written: true,
                durable,
            }
        }
        Ok(resulting) => {
            let _ = staging.keep();
            FavoriteWriteOutcome::Uncertain {
                original_at: None,
                staged_at: Some(shown(&resulting)),
            }
        }
        // Foundation can name the original's own path as where it now is.
        Err(error)
            if error
                .original_at
                .as_deref()
                .is_none_or(|at| same_path(at, &original))
                && proven_unchanged(&original, &identity, &original_bytes) =>
        {
            FavoriteWriteOutcome::Failed {
                reason: FailureReason::Publish,
            }
        }
        Err(error) => {
            // Anything not proven unchanged keeps every file for recovery.
            let staged_at = fs::symlink_metadata(&staged)
                .is_ok()
                .then(|| shown(&staged));
            let _ = staging.keep();
            FavoriteWriteOutcome::Uncertain {
                original_at: error.original_at.as_deref().map(shown),
                staged_at,
            }
        }
    }
}

pub fn set_note_favorite(path: &Path, state: FavoriteState) -> FavoriteWriteOutcome {
    match prepare(path, state) {
        Step::Done(outcome) => outcome,
        Step::Ready(prepared) => commit(prepared, &NativePlatform),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::cell::Cell;

    const BODY: &str = "# Plan\n\nKeep this body.\n";

    type PageAction<'a> = &'a dyn Fn(&Path);

    fn page(dir: &tempfile::TempDir, content: &str) -> PathBuf {
        let path = dir.path().join("page.md");
        fs::write(&path, content).unwrap();
        path
    }

    fn ready(path: &Path, state: FavoriteState) -> Prepared {
        match prepare(path, state) {
            Step::Ready(prepared) => prepared,
            Step::Done(outcome) => panic!("expected a staged write, got {outcome:?}"),
        }
    }

    fn staging_folders(dir: &tempfile::TempDir) -> usize {
        fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name.to_string_lossy().starts_with(STAGING_PREFIX))
            .count()
    }

    /// Calls `act` on the original, then fails without a recovery location.
    struct FailingPublish<F: Fn(&Path)> {
        act: F,
    }

    impl<F: Fn(&Path)> Platform for FailingPublish<F> {
        fn publish(&self, original: &Path, _staged: &Path) -> Result<PathBuf, PublishError> {
            (self.act)(original);
            Err(PublishError {
                original_at: None,
                message: "injected".into(),
            })
        }

        fn sync_dir(&self, _dir: &Path) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct RenamePublish {
        sync_fails: bool,
        published: Cell<usize>,
    }

    impl Platform for RenamePublish {
        fn publish(&self, original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
            self.published.set(self.published.get() + 1);
            fs::rename(staged, original).unwrap();
            Ok(original.to_path_buf())
        }

        fn sync_dir(&self, _dir: &Path) -> std::io::Result<()> {
            if self.sync_fails {
                Err(std::io::ErrorKind::Other.into())
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn transform_matches_the_shared_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/shared/favoriteFrontmatterContract.json"
        ))
        .unwrap();
        for case in contract["cases"].as_array().unwrap() {
            let state = match case["state"]["favoriteIndex"].as_u64() {
                Some(index) => FavoriteState::On(u32::try_from(index).unwrap()),
                None => FavoriteState::Off,
            };
            let content = case["content"].as_str().unwrap();
            let patched = apply_favorite_content(content, state)
                .ok()
                .map(|updated| updated.unwrap_or_else(|| content.to_string()));
            assert_eq!(
                patched.as_deref(),
                case["expected"].as_str(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn already_in_state_returns_file_content_without_publishing() {
        let dir = tempfile::tempdir().unwrap();
        let content = format!("---\n_favorite: true\n_favorite_index: 3\n---\n{BODY}");
        let path = page(&dir, &content);
        let modified = fs::metadata(&path).unwrap().modified().unwrap();

        let Step::Done(outcome) = prepare(&path, FavoriteState::On(3)) else {
            panic!("a no-op must not stage or publish");
        };

        let expected = FavoriteWriteOutcome::Committed {
            content,
            written: false,
            durable: true,
        };
        assert_eq!(outcome, expected);
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
        assert_eq!(staging_folders(&dir), 0);
    }

    #[test]
    fn refuses_missing_links_and_unclosed_blocks_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let on = FavoriteState::On(1);
        let missing = dir.path().join("missing.md");
        let outcome = set_note_favorite(&missing, on);
        assert_eq!(
            outcome,
            FavoriteWriteOutcome::refused(RefusalReason::Missing)
        );
        assert!(!missing.exists());

        let target = page(&dir, BODY);
        let symlink = dir.path().join("link.md");
        std::os::unix::fs::symlink(&target, &symlink).unwrap();
        let hard = dir.path().join("hard.md");
        fs::hard_link(&target, &hard).unwrap();
        let link = FavoriteWriteOutcome::refused(RefusalReason::Link);
        for path in [&symlink, &hard] {
            assert_eq!(set_note_favorite(path, on), link);
        }
        assert_eq!(fs::read_to_string(&target).unwrap(), BODY);

        let unclosed = dir.path().join("unclosed.md");
        fs::write(&unclosed, "---\ntitle: Plan\nBody").unwrap();
        let outcome = set_note_favorite(&unclosed, on);
        assert_eq!(
            outcome,
            FavoriteWriteOutcome::refused(RefusalReason::InvalidFrontmatter)
        );
        assert_eq!(
            fs::read_to_string(&unclosed).unwrap(),
            "---\ntitle: Plan\nBody"
        );
    }

    #[test]
    fn stage_failure_leaves_the_original_and_no_staging() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = page(&dir, BODY);
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();

        let outcome = set_note_favorite(&path, FavoriteState::On(1));

        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(outcome, STAGE_FAILED);
        assert_eq!(fs::read_to_string(&path).unwrap(), BODY);
        assert_eq!(staging_folders(&dir), 0);
    }

    #[test]
    fn outside_change_or_removal_before_commit_is_refused() {
        let edit = |path: &Path| fs::write(path, "edited elsewhere\n").unwrap();
        let remove = |path: &Path| fs::remove_file(path).unwrap();
        let cases: [(PageAction<'_>, RefusalReason); 2] = [
            (&edit, RefusalReason::ChangedOnDisk),
            (&remove, RefusalReason::Missing),
        ];
        for (act, reason) in cases {
            let dir = tempfile::tempdir().unwrap();
            let path = page(&dir, BODY);
            let prepared = ready(&path, FavoriteState::On(1));
            act(&path);
            let before = fs::read(&path).ok();
            let platform = RenamePublish {
                sync_fails: false,
                published: Cell::new(0),
            };

            let outcome = commit(prepared, &platform);

            assert_eq!(outcome, FavoriteWriteOutcome::refused(reason));
            assert_eq!(platform.published.get(), 0);
            assert_eq!(fs::read(&path).ok(), before);
            assert_eq!(staging_folders(&dir), 0);
        }
    }

    #[test]
    fn real_publish_failure_keeps_the_original_and_is_failed() {
        let dir = tempfile::tempdir().unwrap();
        let path = page(&dir, BODY);
        let prepared = ready(&path, FavoriteState::On(1));
        fs::remove_file(&prepared.staged).unwrap();

        let outcome = commit(prepared, &NativePlatform);

        let failed = FavoriteWriteOutcome::Failed {
            reason: FailureReason::Publish,
        };
        assert_eq!(outcome, failed);
        assert_eq!(fs::read_to_string(&path).unwrap(), BODY);
        assert_eq!(staging_folders(&dir), 0);
    }

    #[test]
    fn staged_copy_stays_out_of_git_under_a_parent_negation() {
        let dir = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
        };
        if !git(&["init", "-q"]).is_ok_and(|out| out.status.success()) {
            return; // No Git on this machine.
        }
        fs::write(dir.path().join(".gitignore"), "!*.md\n").unwrap();
        let path = page(&dir, BODY);
        let prepared = ready(&path, FavoriteState::On(1));

        let staged = prepared.staged.strip_prefix(dir.path()).unwrap();
        let ignored = git(&["check-ignore", "-q", staged.to_str().unwrap()]).unwrap();

        assert!(
            ignored.status.success(),
            "the staged page body must be ignored"
        );
    }

    #[test]
    fn publish_error_is_failed_only_when_the_original_is_proven_unchanged() {
        let untouched = |_: &Path| {};
        let same_length = |original: &Path| {
            fs::write(original, BODY.replace("Keep", "Lose")).unwrap();
        };
        let moved = |original: &Path| {
            fs::rename(original, original.with_extension("moved")).unwrap();
        };
        let new_inode = |original: &Path| {
            let copy = original.with_extension("copy");
            fs::copy(original, &copy).unwrap();
            fs::rename(&copy, original).unwrap();
        };
        let cases: [(PageAction<'_>, bool); 4] = [
            (&untouched, true),
            (&same_length, false),
            (&moved, false),
            (&new_inode, false),
        ];

        for (act, proven) in cases {
            let dir = tempfile::tempdir().unwrap();
            let path = page(&dir, BODY);
            let prepared = ready(&path, FavoriteState::On(1));
            let staged = prepared.staged.clone();

            let outcome = commit(prepared, &FailingPublish { act });

            if proven {
                let failed = FavoriteWriteOutcome::Failed {
                    reason: FailureReason::Publish,
                };
                assert_eq!(outcome, failed);
                assert_eq!(fs::read_to_string(&path).unwrap(), BODY);
                assert_eq!(staging_folders(&dir), 0);
            } else {
                let expected = FavoriteWriteOutcome::Uncertain {
                    original_at: None,
                    staged_at: Some(shown(&staged)),
                };
                assert_eq!(outcome, expected);
                assert!(staged.exists(), "recovery copy must survive");
            }
        }
    }

    #[test]
    fn reported_original_location_is_uncertain_and_deletes_nothing() {
        struct MovingPublish;
        impl Platform for MovingPublish {
            fn publish(&self, original: &Path, _staged: &Path) -> Result<PathBuf, PublishError> {
                let moved = original.with_extension("recovered");
                fs::rename(original, &moved).unwrap();
                Err(PublishError {
                    original_at: Some(moved),
                    message: "injected".into(),
                })
            }
            fn sync_dir(&self, _dir: &Path) -> std::io::Result<()> {
                Ok(())
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let path = page(&dir, BODY);
        let prepared = ready(&path, FavoriteState::On(1));
        let staged = prepared.staged.clone();

        let outcome = commit(prepared, &MovingPublish);

        let moved = path.with_extension("recovered");
        let expected = FavoriteWriteOutcome::Uncertain {
            original_at: Some(shown(&moved)),
            staged_at: Some(shown(&staged)),
        };
        assert_eq!(outcome, expected);
        assert_eq!(fs::read_to_string(moved).unwrap(), BODY);
        assert!(staged.exists());
    }

    #[test]
    fn folder_sync_failure_after_publish_stays_committed() {
        let dir = tempfile::tempdir().unwrap();
        let path = page(&dir, BODY);
        let prepared = ready(&path, FavoriteState::On(2));
        let platform = RenamePublish {
            sync_fails: true,
            published: Cell::new(0),
        };

        let outcome = commit(prepared, &platform);

        let content = format!("---\n_favorite: true\n_favorite_index: 2\n---\n{BODY}");
        let expected = FavoriteWriteOutcome::Committed {
            content: content.clone(),
            written: true,
            durable: false,
        };
        assert_eq!(outcome, expected);
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert_eq!(staging_folders(&dir), 0);
    }

    #[test]
    fn outcome_serializes_with_status_tag_and_camel_case_fields() {
        let uncertain = FavoriteWriteOutcome::Uncertain {
            original_at: Some("/a".into()),
            staged_at: None,
        };
        let json = serde_json::to_value(uncertain).unwrap();
        let expected =
            serde_json::json!({ "status": "uncertain", "originalAt": "/a", "stagedAt": null });
        assert_eq!(json, expected);
        let refused = FavoriteWriteOutcome::refused(RefusalReason::ChangedOnDisk);
        let json = serde_json::to_value(refused).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "status": "refused", "reason": "changedOnDisk" })
        );
    }
}
