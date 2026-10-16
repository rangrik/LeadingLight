use crate::commands::expand_tilde;
use crate::vault::{self, DetectedRename, FolderMoveResult, RenameResult};
use serde::Deserialize;
use std::path::Path;

use super::boundary::{with_boundary, with_existing_path_in_requested_vault};

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteFilenameCommandArgs {
    vault_path: String,
    old_path: String,
    new_filename_stem: String,
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
    fn run(self, note: ValidatedNotePath<'_>) -> Result<RenameResult, String> {
        match self {
            Self::Title {
                new_title,
                old_title,
            } => vault::rename_note(vault::RenameNoteRequest {
                vault_path: note.vault_path,
                old_path: note.note_path,
                new_title: &new_title,
                old_title_hint: old_title.as_deref(),
            }),
            Self::Filename { new_filename_stem } => {
                vault::rename_note_filename(vault::RenameNoteFilenameRequest {
                    vault_path: note.vault_path,
                    old_path: note.note_path,
                    new_filename_stem: &new_filename_stem,
                })
            }
        }
    }
}

struct PendingNoteRenameCommand {
    vault_path: String,
    old_path: String,
    args: NoteRenameCommandArgs,
}

enum PublicNoteRenameCommandArgs {
    Title(RenameNoteCommandArgs),
    Filename(RenameNoteFilenameCommandArgs),
}

fn pending_note_rename(
    vault_path: String,
    old_path: String,
    args: NoteRenameCommandArgs,
) -> PendingNoteRenameCommand {
    PendingNoteRenameCommand {
        vault_path,
        old_path,
        args,
    }
}

fn rename_existing_note(command: PendingNoteRenameCommand) -> Result<RenameResult, String> {
    let request = RequestedNotePath::new(&command.vault_path, &command.old_path);
    with_note_path_in_vault(request, |note| command.args.run(note))
}

fn rename_public_note(args: PublicNoteRenameCommandArgs) -> Result<RenameResult, String> {
    let command = match args {
        PublicNoteRenameCommandArgs::Title(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            NoteRenameCommandArgs::Title {
                new_title: args.new_title,
                old_title: args.old_title,
            },
        ),
        PublicNoteRenameCommandArgs::Filename(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            NoteRenameCommandArgs::Filename {
                new_filename_stem: args.new_filename_stem,
            },
        ),
    };
    rename_existing_note(command)
}

pub(crate) fn rename_note_blocking(args: RenameNoteCommandArgs) -> Result<RenameResult, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Title(args))
}

#[tauri::command]
pub async fn rename_note(args: RenameNoteCommandArgs) -> Result<RenameResult, String> {
    super::off_main_thread(move || rename_note_blocking(args)).await
}

pub(crate) fn rename_note_filename_blocking(
    args: RenameNoteFilenameCommandArgs,
) -> Result<RenameResult, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Filename(args))
}

#[tauri::command]
pub async fn rename_note_filename(
    args: RenameNoteFilenameCommandArgs,
) -> Result<RenameResult, String> {
    super::off_main_thread(move || rename_note_filename_blocking(args)).await
}

fn run_folder_move(args: MoveNoteToFolderCommandArgs) -> Result<FolderMoveResult, String> {
    if args.open_paths.len() > 128 {
        return Err("Too many open pages to safely move a page".to_string());
    }
    // One strict requested boundary: do not fall back to another registered vault.
    with_boundary(Some(&args.vault_path), |boundary| {
        let source = boundary
            .validate_existing_paths(std::slice::from_ref(&args.old_path))?
            .remove(0);
        let mut seen = std::collections::HashSet::new();
        let mut open_paths = Vec::new();
        for validated in boundary.validate_existing_paths(&args.open_paths)? {
            let path = std::path::PathBuf::from(validated);
            let identity = path.canonicalize().map_err(|e| e.to_string())?;
            if seen.insert(identity) {
                open_paths.push(path);
            }
        }
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
        vault::move_note_to_folder_with_open_pages(
            vault::MoveNoteToFolderRequest {
                vault_path: &boundary.requested_root().to_string_lossy(),
                old_path: &source,
                destination_folder_path: &destination.to_string_lossy(),
            },
            &open_paths,
        )
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
) -> Result<Option<RenameResult>, String> {
    with_existing_path_in_requested_vault(
        &args.vault_path,
        &args.note_path,
        |requested_root, validated_path| {
            let _lease = crate::leadinglight_history::lease(&[validated_path])?;
            vault::auto_rename_untitled(vault::AutoRenameUntitledRequest {
                vault_path: requested_root,
                note_path: validated_path,
            })
        },
    )
}

#[tauri::command]
pub async fn auto_rename_untitled(
    args: AutoRenameUntitledCommandArgs,
) -> Result<Option<RenameResult>, String> {
    super::off_main_thread(move || auto_rename_untitled_blocking(args)).await
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
}
