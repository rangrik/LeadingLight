use std::path::Path;

use crate::frontmatter;
use crate::frontmatter::favorite::{FavoriteState, FavoriteWriteOutcome, RefusalReason};
use crate::frontmatter::FrontmatterValue;

use super::boundary::{with_existing_paths, with_validated_path, ValidatedPathMode};

pub(crate) fn set_note_favorite_blocking(
    path: String,
    favorite: bool,
    favorite_index: Option<u32>,
    vault_path: Option<String>,
) -> Result<FavoriteWriteOutcome, String> {
    let state = match (favorite, favorite_index) {
        (true, Some(index)) => FavoriteState::On(index),
        (true, None) => return Err("A favorite needs its position".to_string()),
        (false, _) => FavoriteState::Off,
    };
    let validated = with_validated_path(
        &path,
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| Ok(validated_path.to_string()),
    );
    // Boundary refusals are reported as data, so nothing reads as an unknown failure.
    let outcome = match validated {
        Ok(validated) if frontmatter::is_markdown_path(Path::new(&validated)) => {
            frontmatter::favorite::set_note_favorite(Path::new(&validated), state)
        }
        Ok(_) => FavoriteWriteOutcome::refused(RefusalReason::InvalidFrontmatter),
        Err(_) if !Path::new(&path).exists() => {
            FavoriteWriteOutcome::refused(RefusalReason::Missing)
        }
        Err(_) => FavoriteWriteOutcome::refused(RefusalReason::OutsideVault),
    };
    Ok(outcome)
}

#[tauri::command]
pub async fn set_note_favorite(
    path: String,
    favorite: bool,
    favorite_index: Option<u32>,
    vault_path: Option<String>,
) -> Result<FavoriteWriteOutcome, String> {
    super::off_main_thread(move || {
        set_note_favorite_blocking(path, favorite, favorite_index, vault_path)
    })
    .await
}

pub(crate) fn update_frontmatter_blocking(
    path: String,
    key: String,
    value: FrontmatterValue,
    vault_path: Option<String>,
) -> Result<String, String> {
    with_validated_path(
        &path,
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| frontmatter::update_frontmatter(validated_path, &key, value),
    )
}

#[tauri::command]
pub async fn update_frontmatter(
    path: String,
    key: String,
    value: FrontmatterValue,
    vault_path: Option<String>,
) -> Result<String, String> {
    super::off_main_thread(move || update_frontmatter_blocking(path, key, value, vault_path)).await
}

pub(crate) fn delete_frontmatter_property_blocking(
    path: String,
    key: String,
    vault_path: Option<String>,
) -> Result<String, String> {
    with_validated_path(
        &path,
        vault_path.as_deref(),
        ValidatedPathMode::Existing,
        |validated_path| frontmatter::delete_frontmatter_property(validated_path, &key),
    )
}

#[tauri::command]
pub async fn delete_frontmatter_property(
    path: String,
    key: String,
    vault_path: Option<String>,
) -> Result<String, String> {
    super::off_main_thread(move || delete_frontmatter_property_blocking(path, key, vault_path))
        .await
}

#[tauri::command]
pub fn batch_archive_notes(
    paths: Vec<String>,
    vault_path: Option<String>,
) -> Result<usize, String> {
    with_existing_paths(&paths, vault_path.as_deref(), |validated_paths| {
        let mut count = 0;
        for path in &validated_paths {
            frontmatter::update_frontmatter(path, "_archived", FrontmatterValue::Bool(true))?;
            count += 1;
        }
        Ok(count)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_path(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().into_owned()
    }

    fn write_note(path: &str, content: &str) {
        std::fs::write(path, content).unwrap();
    }

    #[tokio::test]
    async fn update_frontmatter_command_validates_and_updates_note() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = note_path(&dir, "note.md");
        write_note(&path, "---\nStatus: Draft\n---\n# Note\n");

        let updated = update_frontmatter(
            path.clone(),
            "Status".to_string(),
            FrontmatterValue::String("Done".to_string()),
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .await
        .unwrap();

        assert!(updated.contains("Status: Done"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), updated);
    }

    #[tokio::test]
    async fn delete_frontmatter_property_command_removes_existing_key() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = note_path(&dir, "note.md");
        write_note(&path, "---\nStatus: Draft\nOwner: Ada\n---\n# Note\n");

        let updated = delete_frontmatter_property(
            path,
            "Owner".to_string(),
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .await
        .unwrap();

        assert!(!updated.contains("Owner:"));
        assert!(updated.contains("Status: Draft"));
    }

    #[test]
    fn batch_archive_notes_command_marks_each_note_archived() {
        let dir = tempfile::TempDir::new().unwrap();
        let first = note_path(&dir, "first.md");
        let second = note_path(&dir, "second.md");
        write_note(&first, "---\nStatus: Draft\n---\n# First\n");
        write_note(&second, "# Second\n");

        let count = batch_archive_notes(
            vec![first.clone(), second.clone()],
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();

        assert_eq!(count, 2);
        assert!(std::fs::read_to_string(first)
            .unwrap()
            .contains("_archived: true"));
        assert!(std::fs::read_to_string(second)
            .unwrap()
            .contains("_archived: true"));
    }

    #[tokio::test]
    async fn set_note_favorite_command_returns_boundary_refusals_as_data() {
        let vault = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let vault_arg = Some(vault.path().to_string_lossy().into_owned());
        let outside_note = note_path(&outside, "outside.md");
        write_note(&outside_note, "# Outside\n");
        let image = note_path(&vault, "image.png");
        write_note(&image, "not markdown");
        let note = note_path(&vault, "note.md");
        write_note(&note, "# Note\n");

        let refused = |reason| -> Result<FavoriteWriteOutcome, String> {
            Ok(FavoriteWriteOutcome::refused(reason))
        };
        let favorite =
            |path: &str| set_note_favorite(path.to_string(), true, Some(1), vault_arg.clone());
        assert_eq!(favorite(&outside_note).await, refused(RefusalReason::OutsideVault));
        assert_eq!(favorite(&image).await, refused(RefusalReason::InvalidFrontmatter));
        assert_eq!(std::fs::read_to_string(&outside_note).unwrap(), "# Outside\n");

        let committed = favorite(&note).await.unwrap();
        let content = "---\n_favorite: true\n_favorite_index: 1\n---\n# Note\n".to_string();
        let expected = FavoriteWriteOutcome::Committed {
            content: content.clone(),
            written: true,
            durable: true,
        };
        assert_eq!(committed, expected);
        assert_eq!(std::fs::read_to_string(&note).unwrap(), content);
    }

    #[test]
    fn batch_archive_notes_command_rejects_notes_outside_vault() {
        let vault = tempfile::TempDir::new().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let outside_note = note_path(&outside, "outside.md");
        write_note(&outside_note, "# Outside\n");

        let error = batch_archive_notes(
            vec![outside_note],
            Some(vault.path().to_string_lossy().into_owned()),
        )
        .unwrap_err();

        assert!(error.contains("Path must stay inside the active vault"));
    }
}
