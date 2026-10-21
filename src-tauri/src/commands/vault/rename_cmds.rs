use crate::commands::expand_tilde;
use crate::vault::{self, DetectedRename, FolderMoveResult, PageRenameReceipt, RenameResult};
use serde::Deserialize;
use std::path::{Path, PathBuf};

use super::boundary::{with_boundary, with_existing_path_in_requested_vault};

/// The renderer's open pages a managed rename reports exact text for.
const MAX_OPEN_PAGES: usize = 128;

/// Marks a managed rename this worker refused before publishing its source (Amendment B1). Added
/// inside the completed worker only, so a panic or a lost reply never carries it: the renderer then
/// treats the outcome as unknown instead of as proof that nothing was written.
pub(crate) const RENAME_REFUSED_PREFIX: &str = "leadinglight-rename-refused: ";

/// An error is an explicit refusal only while the source is still at its old path; a failed
/// rollback leaves it in the transaction backup, and a missing source proves nothing either.
fn refused_before_publication<T>(old_path: &str, result: Result<T, String>) -> Result<T, String> {
    result.map_err(|error| {
        if Path::new(expand_tilde(old_path).as_ref()).exists() {
            format!("{RENAME_REFUSED_PREFIX}{error}")
        } else {
            error
        }
    })
}

/// Open pages inside the one requested vault, each identity once. A page removed outside the
/// app cannot be refreshed, so it is reported back as unrefreshed instead of refusing the rename.
#[derive(Default)]
struct OpenPages {
    existing: Vec<PathBuf>,
    missing: Vec<String>,
}

impl OpenPages {
    fn validate(vault_path: &str, raw_paths: &[String]) -> Result<Self, String> {
        if raw_paths.len() > MAX_OPEN_PAGES {
            return Err("Too many open pages to safely rename a page".to_string());
        }
        // One strict requested boundary: do not fall back to another registered vault.
        with_boundary(Some(vault_path), |boundary| {
            let mut seen = std::collections::HashSet::new();
            let mut pages = Self::default();
            for raw in raw_paths {
                match boundary.validate_existing_paths(std::slice::from_ref(raw)) {
                    Ok(mut validated) => {
                        let path = PathBuf::from(validated.remove(0));
                        let identity = path.canonicalize().map_err(|e| e.to_string())?;
                        if seen.insert(identity) {
                            pages.existing.push(path);
                        }
                    }
                    Err(error) if error.starts_with("ENOENT") => {
                        if !pages.missing.contains(raw) {
                            pages.missing.push(raw.clone());
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
            Ok(pages)
        })
    }

    fn account(self, mut receipt: PageRenameReceipt) -> PageRenameReceipt {
        receipt.unrefreshed_open_paths.extend(self.missing);
        receipt.unrefreshed_open_paths.sort();
        receipt
    }
}

struct RequestedNotePath<'a> {
    vault_path: &'a str,
    note_path: &'a str,
}

struct ValidatedNotePath<'a> {
    vault_path: &'a str,
    note_path: &'a str,
}

impl<'a> RequestedNotePath<'a> {
    fn new(vault_path: &'a str, note_path: &'a str) -> Self {
        Self {
            vault_path,
            note_path,
        }
    }
}

fn with_note_path_in_vault<T>(
    request: RequestedNotePath<'_>,
    action: impl FnOnce(ValidatedNotePath<'_>) -> Result<T, String>,
) -> Result<T, String> {
    with_existing_path_in_requested_vault(
        request.vault_path,
        request.note_path,
        |requested_root, validated_path| {
            let _lease = crate::leadinglight_history::lease(&[validated_path])?;
            action(ValidatedNotePath {
                vault_path: requested_root,
                note_path: validated_path,
            })
        },
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNoteToWorkspaceCommandArgs {
    source_vault_path: String,
    destination_vault_path: String,
    old_path: String,
    replacement_target: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteCommandArgs {
    vault_path: String,
    old_path: String,
    new_title: String,
    old_title: Option<String>,
    #[serde(default)]
    open_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteFilenameCommandArgs {
    vault_path: String,
    old_path: String,
    new_filename_stem: String,
    #[serde(default)]
    open_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNoteToFolderCommandArgs {
    vault_path: String,
    old_path: String,
    folder_path: String,
    #[serde(default)]
    open_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRenameUntitledCommandArgs {
    vault_path: String,
    note_path: String,
    #[serde(default)]
    open_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPathCommandArgs {
    vault_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWikilinksForRenamesCommandArgs {
    vault_path: String,
    renames: Vec<DetectedRename>,
}

enum NoteRenameCommandArgs {
    Title {
        new_title: String,
        old_title: Option<String>,
    },
    Filename {
        new_filename_stem: String,
    },
}

impl NoteRenameCommandArgs {
    fn run(
        self,
        note: ValidatedNotePath<'_>,
        open_paths: &[PathBuf],
    ) -> Result<PageRenameReceipt, String> {
        match self {
            Self::Title {
                new_title,
                old_title,
            } => vault::rename_note_with_open_pages(
                vault::RenameNoteRequest {
                    vault_path: note.vault_path,
                    old_path: note.note_path,
                    new_title: &new_title,
                    old_title_hint: old_title.as_deref(),
                },
                open_paths,
            ),
            Self::Filename { new_filename_stem } => vault::rename_note_filename_with_open_pages(
                vault::RenameNoteFilenameRequest {
                    vault_path: note.vault_path,
                    old_path: note.note_path,
                    new_filename_stem: &new_filename_stem,
                },
                open_paths,
            ),
        }
    }
}

struct PendingNoteRenameCommand {
    vault_path: String,
    old_path: String,
    open_paths: Vec<String>,
    args: NoteRenameCommandArgs,
}

enum PublicNoteRenameCommandArgs {
    Title(RenameNoteCommandArgs),
    Filename(RenameNoteFilenameCommandArgs),
}

fn pending_note_rename(
    vault_path: String,
    old_path: String,
    open_paths: Vec<String>,
    args: NoteRenameCommandArgs,
) -> PendingNoteRenameCommand {
    PendingNoteRenameCommand {
        vault_path,
        old_path,
        open_paths,
        args,
    }
}

fn rename_existing_note(command: PendingNoteRenameCommand) -> Result<PageRenameReceipt, String> {
    if command.open_paths.len() > MAX_OPEN_PAGES {
        return Err("Too many open pages to safely rename a page".to_string());
    }
    let request = RequestedNotePath::new(&command.vault_path, &command.old_path);
    with_note_path_in_vault(request, |note| {
        let open = OpenPages::validate(note.vault_path, &command.open_paths)?;
        let receipt = command.args.run(note, &open.existing)?;
        Ok(open.account(receipt))
    })
}

fn rename_public_note(args: PublicNoteRenameCommandArgs) -> Result<PageRenameReceipt, String> {
    let command = match args {
        PublicNoteRenameCommandArgs::Title(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            args.open_paths,
            NoteRenameCommandArgs::Title {
                new_title: args.new_title,
                old_title: args.old_title,
            },
        ),
        PublicNoteRenameCommandArgs::Filename(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            args.open_paths,
            NoteRenameCommandArgs::Filename {
                new_filename_stem: args.new_filename_stem,
            },
        ),
    };
    rename_existing_note(command)
}

pub(crate) fn rename_note_blocking(
    args: RenameNoteCommandArgs,
) -> Result<PageRenameReceipt, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Title(args))
}

#[tauri::command]
pub async fn rename_note(args: RenameNoteCommandArgs) -> Result<PageRenameReceipt, String> {
    let old_path = args.old_path.clone();
    super::off_main_thread(move || {
        refused_before_publication(&old_path, rename_note_blocking(args))
    })
    .await
}

pub(crate) fn rename_note_filename_blocking(
    args: RenameNoteFilenameCommandArgs,
) -> Result<PageRenameReceipt, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Filename(args))
}

#[tauri::command]
pub async fn rename_note_filename(
    args: RenameNoteFilenameCommandArgs,
) -> Result<PageRenameReceipt, String> {
    let old_path = args.old_path.clone();
    super::off_main_thread(move || {
        refused_before_publication(&old_path, rename_note_filename_blocking(args))
    })
    .await
}

fn run_folder_move(args: MoveNoteToFolderCommandArgs) -> Result<FolderMoveResult, String> {
    if args.open_paths.len() > MAX_OPEN_PAGES {
        return Err("Too many open pages to safely move a page".to_string());
    }
    // One strict requested boundary: do not fall back to another registered vault.
    with_boundary(Some(&args.vault_path), |boundary| {
        let source = boundary
            .validate_existing_paths(std::slice::from_ref(&args.old_path))?
            .remove(0);
        let open = OpenPages::validate(
            &boundary.requested_root().to_string_lossy(),
            &args.open_paths,
        )?;
        let folder = args.folder_path.trim();
        let destination = if folder.is_empty() {
            boundary.requested_root().to_path_buf()
        } else {
            boundary.child_path(folder)?
        };
        if !destination.is_dir() {
            return Err(format!("Folder does not exist: {}", folder));
        }
        let _lease = crate::leadinglight_history::lease(&[Path::new(&source)])?;
        let receipt = vault::move_note_to_folder_with_open_pages(
            vault::MoveNoteToFolderRequest {
                vault_path: &boundary.requested_root().to_string_lossy(),
                old_path: &source,
                destination_folder_path: &destination.to_string_lossy(),
            },
            &open.existing,
        )?;
        Ok(open.account(receipt))
    })
}

pub(crate) fn move_note_to_folder_blocking(
    args: MoveNoteToFolderCommandArgs,
) -> Result<FolderMoveResult, String> {
    run_folder_move(args)
}

#[tauri::command]
pub async fn move_note_to_folder(
    args: MoveNoteToFolderCommandArgs,
) -> Result<FolderMoveResult, String> {
    super::off_main_thread(move || move_note_to_folder_blocking(args)).await
}

#[tauri::command]
pub fn move_note_to_workspace(
    args: MoveNoteToWorkspaceCommandArgs,
) -> Result<RenameResult, String> {
    let request = RequestedNotePath::new(&args.source_vault_path, &args.old_path);
    with_note_path_in_vault(request, |note| {
        let source_root_path = Path::new(note.vault_path);
        let old_file = Path::new(note.note_path);
        let relative_path = old_file
            .strip_prefix(source_root_path)
            .map_err(|_| "Path must stay inside the source vault".to_string())?;
        let relative_path = relative_path.to_string_lossy();

        with_boundary(Some(&args.destination_vault_path), |destination_boundary| {
            let destination_path = destination_boundary.child_path(relative_path.as_ref())?;
            let destination_root = destination_boundary
                .requested_root()
                .to_string_lossy()
                .into_owned();
            let destination_path = destination_path.to_string_lossy().into_owned();
            vault::move_note_to_workspace(vault::MoveNoteToWorkspaceRequest {
                source_vault_path: note.vault_path,
                destination_vault_path: &destination_root,
                old_path: note.note_path,
                destination_path: &destination_path,
                replacement_target: args.replacement_target.as_deref(),
            })
        })
    })
}

pub(crate) fn auto_rename_untitled_blocking(
    args: AutoRenameUntitledCommandArgs,
) -> Result<Option<PageRenameReceipt>, String> {
    if args.open_paths.len() > MAX_OPEN_PAGES {
        return Err("Too many open pages to safely rename a page".to_string());
    }
    with_existing_path_in_requested_vault(
        &args.vault_path,
        &args.note_path,
        |requested_root, validated_path| {
            let _lease = crate::leadinglight_history::lease(&[validated_path])?;
            let open = OpenPages::validate(requested_root, &args.open_paths)?;
            let receipt = vault::auto_rename_untitled_with_open_pages(
                vault::AutoRenameUntitledRequest {
                    vault_path: requested_root,
                    note_path: validated_path,
                },
                &open.existing,
            )?;
            Ok(receipt.map(|receipt| open.account(receipt)))
        },
    )
}

#[tauri::command]
pub async fn auto_rename_untitled(
    args: AutoRenameUntitledCommandArgs,
) -> Result<Option<PageRenameReceipt>, String> {
    let note_path = args.note_path.clone();
    super::off_main_thread(move || {
        refused_before_publication(&note_path, auto_rename_untitled_blocking(args))
    })
    .await
}

#[tauri::command]
pub async fn detect_renames(args: VaultPathCommandArgs) -> Result<Vec<DetectedRename>, String> {
    let vault_path = expand_tilde(&args.vault_path).into_owned();
    crate::commands::blocking::run_blocking_labeled("Rename detection task panicked", move || {
        vault::detect_renames(Path::new(&vault_path))
    })
    .await?
}

pub(crate) fn update_wikilinks_for_renames_blocking(
    args: UpdateWikilinksForRenamesCommandArgs,
) -> Result<usize, String> {
    let vault_path = expand_tilde(&args.vault_path);
    vault::update_wikilinks_for_renames(Path::new(vault_path.as_ref()), &args.renames)
}

#[tauri::command]
pub async fn update_wikilinks_for_renames(
    args: UpdateWikilinksForRenamesCommandArgs,
) -> Result<usize, String> {
    super::off_main_thread(move || update_wikilinks_for_renames_blocking(args)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn vault_path(dir: &TempDir) -> String {
        dir.path().to_string_lossy().into_owned()
    }

    fn write_note(dir: &TempDir, relative_path: &str, content: &str) -> String {
        let path = dir.path().join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn rename_note_command_updates_title_file_and_links() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let old_path = write_note(
            &dir,
            "old-title.md",
            "---\ntitle: Old Title\n---\n# Old Title\n",
        );
        let linked_path = write_note(&dir, "linked.md", "See [[Old Title]].\n");

        let result = rename_note(RenameNoteCommandArgs {
            vault_path: vault.clone(),
            old_path: old_path.clone(),
            new_title: "New Title".to_string(),
            old_title: None,
            open_paths: Vec::new(),
        })
        .await
        .unwrap();

        assert!(result.new_path.ends_with("new-title.md"));
        assert!(!Path::new(&old_path).exists());
        assert!(Path::new(&result.new_path).exists());
        assert!(fs::read_to_string(linked_path)
            .unwrap()
            .contains("[[new-title]]"));
        assert_eq!(result.failed_updates, 0);
    }

    #[tokio::test]
    async fn filename_and_folder_commands_preserve_note_content() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let old_path = write_note(
            &dir,
            "draft.md",
            "---\ntitle: Draft Title\n---\n# Draft Title\n",
        );

        let renamed = rename_note_filename(RenameNoteFilenameCommandArgs {
            vault_path: vault.clone(),
            old_path,
            new_filename_stem: "custom-name".to_string(),
            open_paths: Vec::new(),
        })
        .await
        .unwrap();
        assert!(renamed.new_path.ends_with("custom-name.md"));

        fs::create_dir(dir.path().join("Projects")).unwrap();
        let moved = move_note_to_folder(MoveNoteToFolderCommandArgs {
            vault_path: vault.clone(),
            old_path: renamed.new_path.clone(),
            folder_path: "Projects".to_string(),
            open_paths: Vec::new(),
        })
        .await
        .unwrap();

        assert!(moved.new_path.ends_with("Projects/custom-name.md"));
        assert!(fs::read_to_string(moved.new_path)
            .unwrap()
            .contains("Draft Title"));
    }

    #[test]
    fn move_note_to_workspace_command_preserves_relative_path() {
        let source = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        let source_vault = vault_path(&source);
        let destination_vault = vault_path(&destination);
        let old_path = write_note(
            &source,
            "Projects/draft.md",
            "---\ntitle: Draft Title\n---\n# Draft Title\n",
        );
        let linked_path = write_note(&source, "linked.md", "See [[Draft Title]].\n");

        let moved = move_note_to_workspace(MoveNoteToWorkspaceCommandArgs {
            source_vault_path: source_vault,
            destination_vault_path: destination_vault.clone(),
            old_path: old_path.clone(),
            replacement_target: Some("team/Projects/draft".to_string()),
        })
        .unwrap();

        assert!(!Path::new(&old_path).exists());
        assert!(moved.new_path.ends_with("Projects/draft.md"));
        assert!(moved.new_path.starts_with(&destination_vault));
        assert!(fs::read_to_string(moved.new_path)
            .unwrap()
            .contains("Draft Title"));
        assert!(fs::read_to_string(linked_path)
            .unwrap()
            .contains("[[team/Projects/draft]]"));
    }

    #[tokio::test]
    async fn auto_rename_and_detected_rename_commands_route_through_vault() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let untitled = write_note(&dir, "untitled-note-123.md", "# Project Plan\n");

        let auto = auto_rename_untitled(AutoRenameUntitledCommandArgs {
            vault_path: vault.clone(),
            note_path: untitled,
            open_paths: Vec::new(),
        })
        .await
        .unwrap()
        .unwrap();
        assert!(auto.new_path.ends_with("project-plan.md"));

        crate::git::init_repo(&vault).unwrap();
        let old_path = dir.path().join("project-plan.md");
        let new_path = dir.path().join("plans.md");
        fs::rename(&old_path, &new_path).unwrap();
        crate::hidden_command("git")
            .args(["add", "-A"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let renames = detect_renames(VaultPathCommandArgs {
            vault_path: vault.clone(),
        })
        .await
        .unwrap();
        assert_eq!(renames.len(), 1);
        assert_eq!(renames[0].old_path, "project-plan.md");
        assert_eq!(renames[0].new_path, "plans.md");

        assert_eq!(
            update_wikilinks_for_renames(UpdateWikilinksForRenamesCommandArgs {
                vault_path: vault,
                renames,
            })
            .await
            .unwrap(),
            0,
        );
    }

    #[tokio::test]
    async fn leadinglight_folder_receipt_rejects_open_paths_outside_requested_vault() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let note = write_note(&dir, "page.md", "# Page\n");
        let other = write_note(&outside, "other.md", "# Synthetic outside\n");
        fs::create_dir(dir.path().join("filed")).unwrap();
        let result = move_note_to_folder(MoveNoteToFolderCommandArgs {
            vault_path: vault_path(&dir),
            old_path: note.clone(),
            folder_path: "filed".to_string(),
            open_paths: vec![other],
        })
        .await;
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(note).unwrap(), "# Page\n");
        assert!(!dir.path().join("filed/page.md").exists());
    }

    #[tokio::test]
    async fn move_note_to_folder_accepts_empty_folder_as_vault_root() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let note = write_note(&dir, "projects/note.md", "# Note\n");

        let result = move_note_to_folder(MoveNoteToFolderCommandArgs {
            vault_path: vault,
            old_path: note,
            folder_path: "  ".to_string(),
            open_paths: Vec::new(),
        })
        .await
        .unwrap();

        assert!(result.new_path.ends_with("note.md"));
        assert!(dir.path().join("note.md").exists());
        assert!(!dir.path().join("projects/note.md").exists());
    }

    #[tokio::test]
    async fn leadinglight_rename_commands_return_receipts_for_open_pages() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let source = write_note(&dir, "Topics/plan.md", "# Plan\n");
        let open = write_note(&dir, "Notes/commentary.md", "[Source](../Topics/plan.md)\n");
        let gone = dir
            .path()
            .join("Notes/closed-elsewhere.md")
            .to_string_lossy()
            .into_owned();

        let receipt = rename_note_filename(RenameNoteFilenameCommandArgs {
            vault_path: vault.clone(),
            old_path: source,
            new_filename_stem: "goals".to_string(),
            open_paths: vec![open.clone(), open.clone(), gone.clone()],
        })
        .await
        .unwrap();

        assert!(receipt.new_path.ends_with("Topics/goals.md"));
        assert_eq!(receipt.updated_open_pages.len(), 1);
        assert_eq!(receipt.updated_open_pages[0].path, open);
        assert_eq!(
            receipt.updated_open_pages[0].content,
            "[Source](../Topics/goals.md)\n"
        );
        // A page removed outside the app is accounted for, not a reason to refuse.
        assert_eq!(receipt.unrefreshed_open_paths, vec![gone]);

        let auto_source = write_note(&dir, "untitled-note-42.md", "# Harbor\n");
        let auto_open = write_note(&dir, "Notes/auto.md", "[Source](../untitled-note-42.md)\n");
        let auto = auto_rename_untitled(AutoRenameUntitledCommandArgs {
            vault_path: vault,
            note_path: auto_source,
            open_paths: vec![auto_open.clone()],
        })
        .await
        .unwrap()
        .unwrap();
        assert!(auto.new_path.ends_with("harbor.md"));
        assert_eq!(auto.updated_open_pages[0].path, auto_open);
    }

    #[tokio::test]
    async fn leadinglight_rename_refuses_open_pages_outside_the_vault_before_any_change() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let source = write_note(&dir, "plan.md", "# Plan\n");
        let other = write_note(&outside, "other.md", "# Synthetic outside\n");

        let result = rename_note(RenameNoteCommandArgs {
            vault_path: vault_path(&dir),
            old_path: source.clone(),
            new_title: "Goals".to_string(),
            old_title: None,
            open_paths: vec![other],
        })
        .await;

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(source).unwrap(), "# Plan\n");
        assert!(!dir.path().join("goals.md").exists());
    }

    #[tokio::test]
    async fn leadinglight_managed_rename_refusals_are_explicit_only_while_the_source_is_in_place() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let source = write_note(&dir, "plan.md", "# Plan\n");
        write_note(&dir, "goals.md", "# Goals\n");

        let taken = rename_note_filename(RenameNoteFilenameCommandArgs {
            vault_path: vault.clone(),
            old_path: source.clone(),
            new_filename_stem: "goals".to_string(),
            open_paths: Vec::new(),
        })
        .await
        .unwrap_err();
        assert_eq!(
            taken,
            format!("{RENAME_REFUSED_PREFIX}A note with that name already exists")
        );
        assert_eq!(fs::read_to_string(&source).unwrap(), "# Plan\n");

        let missing = rename_note(RenameNoteCommandArgs {
            vault_path: vault,
            old_path: dir.path().join("gone.md").to_string_lossy().into_owned(),
            new_title: "Gone".to_string(),
            old_title: None,
            open_paths: Vec::new(),
        })
        .await
        .unwrap_err();
        assert!(!missing.starts_with(RENAME_REFUSED_PREFIX), "{missing}");
    }
}
