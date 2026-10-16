//! Publishes a staged copy over an existing file in one step, on the same volume.

use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct PublishError {
    /// Where the platform says the original now is, when it moved it.
    pub original_at: Option<PathBuf>,
    pub message: String,
}

impl PublishError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            original_at: None,
            message: message.into(),
        }
    }
}

/// Default options keep the original's creation date, permissions, Finder label and comments.
#[cfg(target_os = "macos")]
pub(crate) fn replace_item(original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
    use objc2_foundation::{NSFileManager, NSFileManagerItemReplacementOptions, NSURL};

    objc2::rc::autoreleasepool(|_| {
        let original_url = NSURL::from_file_path(original)
            .ok_or_else(|| PublishError::new("The page path cannot be used as a file URL"))?;
        let staged_url = NSURL::from_file_path(staged)
            .ok_or_else(|| PublishError::new("The staged path cannot be used as a file URL"))?;
        let mut resulting = None;
        NSFileManager::defaultManager()
            .replaceItemAtURL_withItemAtURL_backupItemName_options_resultingItemURL_error(
                &original_url,
                &staged_url,
                None,
                NSFileManagerItemReplacementOptions(0),
                Some(&mut resulting),
            )
            .map(|()| {
                resulting
                    .and_then(|url| url.to_file_path())
                    .unwrap_or_else(|| original.to_path_buf())
            })
            .map_err(|error| PublishError {
                original_at: original_location(&error),
                message: error.localizedDescription().to_string(),
            })
    })
}

#[cfg(target_os = "macos")]
fn original_location(error: &objc2_foundation::NSError) -> Option<PathBuf> {
    use objc2_foundation::{NSString, NSURL};

    let key = NSString::from_str("NSFileOriginalItemLocationKey");
    let value = error.userInfo().objectForKey(&key)?;
    value.downcast::<NSURL>().ok()?.to_file_path()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn replace_item(original: &Path, staged: &Path) -> Result<PathBuf, PublishError> {
    std::fs::rename(staged, original)
        .map(|()| original.to_path_buf())
        .map_err(|error| PublishError::new(error.to_string()))
}

/// Makes the directory entry change durable after a publish.
pub(crate) fn sync_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(dir)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    fn run(program: &str, args: &[&str]) -> String {
        let output = Command::new(program).args(args).output().unwrap();
        assert!(output.status.success(), "{program} {args:?} failed");
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    #[test]
    fn replace_keeps_birthtime_mode_xattrs_and_acl() {
        let dir = tempfile::tempdir().unwrap();
        let page = dir.path().join("page.md");
        fs::write(&page, "old").unwrap();
        fs::set_permissions(&page, fs::Permissions::from_mode(0o640)).unwrap();
        let page_arg = page.to_str().unwrap();
        let tags = "com.apple.metadata:_kMDItemUserTags";
        run(
            "/usr/bin/xattr",
            &["-w", "com.leadinglight.test", "kept", page_arg],
        );
        run(
            "/usr/bin/xattr",
            &["-w", tags, "<string>Red</string>", page_arg],
        );
        run("/bin/chmod", &["+a", "everyone allow read", page_arg]);
        let created = fs::metadata(&page).unwrap().created().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));

        let staging = tempfile::Builder::new()
            .prefix(".leadinglight-")
            .tempdir_in(dir.path())
            .unwrap();
        let staged = staging.path().join("page.md");
        fs::write(&staged, "new").unwrap();
        let resulting = replace_item(&page, &staged).unwrap();

        let canonical = fs::canonicalize(&page).unwrap();
        assert_eq!(fs::canonicalize(resulting).unwrap(), canonical);
        assert_eq!(fs::read_to_string(&page).unwrap(), "new");
        let meta = fs::metadata(&page).unwrap();
        // Foundation keeps dates as a double of seconds since 2001, about 119 ns per step today.
        let created_after = meta.created().unwrap();
        let drift = created_after
            .duration_since(created)
            .unwrap_or_else(|e| e.duration());
        assert!(
            drift < std::time::Duration::from_nanos(500),
            "creation date moved {drift:?}"
        );
        assert_eq!(meta.permissions().mode() & 0o777, 0o640);
        let custom = run("/usr/bin/xattr", &["-p", "com.leadinglight.test", page_arg]);
        assert_eq!(custom.trim(), "kept");
        assert!(run("/usr/bin/xattr", &["-p", tags, page_arg]).contains("Red"));
        assert!(run("/bin/ls", &["-le", page_arg]).contains("everyone allow read"));
        assert!(!staged.exists());
    }
}
