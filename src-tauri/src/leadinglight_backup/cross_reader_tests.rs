//! Native <-> bridge backup acceptance through the bridge's real Node helper
//! (`scripts/leadinglight-backup-cross-reader.mjs`). Opt-in: `--ignored --nocapture`, Node 22.6+.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tempfile::TempDir;

use super::backup;
use super::registry::Op;
use super::restore;
use super::rules::MANIFEST;
use super::*;
use crate::leadinglight_history::history_outcome::ListVersionsOutcome;
use crate::leadinglight_history::{list_versions, page_key, PageTarget};

const VAULT_MARKER: (&str, &str) = (
    ".leadinglight-synthetic-vault",
    "leadinglight synthetic vault\n",
);
const OUTPUT_MARKER: (&str, &str) = (
    ".leadinglight-synthetic-output",
    "leadinglight synthetic output\n",
);

/// One request to the bridge helper. A missing Node fails the test, never passes it.
fn helper(request: &Value) -> Value {
    let mut child = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap())
        .args([
            "--experimental-strip-types",
            "scripts/leadinglight-backup-cross-reader.mjs",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("acceptance gate missing: Node 22.6 or later must be on PATH");
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(request.to_string().as_bytes()).unwrap();
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let answer: Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("the helper gave no JSON answer: {stderr}"));
    assert!(out.status.success(), "{answer} {stderr}");
    answer
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn marked(dir: &Path, (name, content): (&str, &str)) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(name), content).unwrap();
}

fn roots(dir: &Path) -> VaultRoots {
    VaultRoots {
        requested: dir.to_path_buf(),
        canonical: dir.canonicalize().unwrap(),
    }
}

/// Path → (bytes, sha256) of every regular file, as the manifest lists them.
fn listed(files: &Value) -> BTreeMap<String, (u64, String)> {
    files
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap().to_string(),
                (
                    file["bytes"].as_u64().unwrap(),
                    file["sha256"].as_str().unwrap().to_string(),
                ),
            )
        })
        .collect()
}

/// The same view of a real folder, never through a link; the output marker is not data.
fn on_disk(dir: &Path) -> BTreeMap<String, (u64, String)> {
    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            let bytes = fs::read(entry.path()).unwrap();
            let rel = entry.path().strip_prefix(dir).unwrap().to_string_lossy();
            let sha = fsx::hex(&crate::vault::staged_file::sha256(&bytes));
            (rel.into_owned(), (bytes.len() as u64, sha))
        })
        .collect()
}

fn version_count(workspace: &Path) -> usize {
    let path = workspace.join("notes/history.md");
    let target = PageTarget {
        key: page_key(&path).unwrap(),
        path,
    };
    match list_versions(&roots(workspace), &target, None) {
        ListVersionsOutcome::Ok { versions, .. } => versions.len(),
        other => panic!("{other:?}"),
    }
}

/// Seam: the backup folder format shared by native and the bridge. Catches either side writing a
/// manifest, exclusion, gap, history copy or byte the other cannot inspect and restore exactly.
#[test]
#[ignore = "runs the bridge's Node helper"]
fn native_and_bridge_restore_each_others_backups() {
    let temp = TempDir::new().unwrap();
    let vault = temp.path().join("vault");
    let out = temp.path().join("out");
    marked(&vault, VAULT_MARKER);
    marked(&out, OUTPUT_MARKER);
    let seeded = helper(&json!({"op": "seed", "vault": text(&vault)}));
    let expected = listed(&seeded["expected"]["files"]);
    println!("seeded {} files", expected.len());

    // Native writes, bridge reads.
    let job = prepare_backup(roots(&vault), &text(&out), Vec::new()).unwrap();
    let native = match backup::run(&Op::new(Kind::Backup), job) {
        BackupResult::Incomplete(saved) => saved,
        other => panic!("{other:?}"),
    };
    let native_folder = PathBuf::from(&native.folder);
    let manifest_bytes = fs::read(native_folder.join(MANIFEST)).unwrap();
    let native_manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    let native_sha = fsx::hex(&crate::vault::staged_file::sha256(&manifest_bytes));
    assert_eq!(listed(&native_manifest["files"]), expected);
    assert_eq!(native_manifest["gaps"], seeded["expected"]["gaps"]);
    assert_eq!(native.versions_skipped, 1);
    assert_eq!(native.trash_items_not_included, 1);
    let inspected = helper(&json!({"op": "inspect", "backup": native.folder}));
    assert_eq!(inspected["result"]["status"], "ok", "{inspected}");
    assert_eq!(inspected["result"]["manifestSha256"], native_sha.as_str());
    let restored = helper(&json!({"op": "restore", "backup": native.folder,
        "manifestSha256": native_sha, "parent": text(&out), "name": "from-native"}));
    assert_eq!(restored["result"]["status"], "restored", "{restored}");
    let from_native = out.join("from-native");
    assert_eq!(on_disk(&from_native), expected);
    assert_eq!(version_count(&from_native), 1);

    // Bridge writes, native reads.
    let bridged =
        helper(&json!({"op": "backup", "vault": text(&vault), "destination": text(&out)}));
    assert_eq!(bridged["result"]["status"], "incomplete", "{bridged}");
    let bridge_folder = PathBuf::from(bridged["result"]["folder"].as_str().unwrap());
    let bridge_sha = bridged["manifestSha256"].as_str().unwrap().to_string();
    let bridge_manifest = &bridged["manifest"];
    for field in [
        "status",
        "gaps",
        "gapsTotal",
        "versionsSkipped",
        "trashItemsNotIncluded",
        "totalFiles",
        "totalBytes",
        "workspaceName",
    ] {
        assert_eq!(bridge_manifest[field], native_manifest[field], "{field}");
    }
    assert_eq!(listed(&bridge_manifest["files"]), expected);
    let inspection = restore::inspect(
        &Op::new(Kind::Inspect),
        prepare_inspect(&text(&bridge_folder)).unwrap(),
    );
    let InspectResult::Ok {
        manifest_sha256, ..
    } = inspection
    else {
        panic!("{inspection:?}");
    };
    assert_eq!(manifest_sha256, bridge_sha);
    let job = prepare_restore(
        &text(&bridge_folder),
        &bridge_sha,
        &text(&out),
        "from-bridge",
        &[],
    )
    .unwrap();
    let result = restore::restore(&Op::new(Kind::Restore), job);
    assert!(
        matches!(
            result,
            RestoreResult::Restored {
                times_kept: true,
                ..
            }
        ),
        "{result:?}"
    );
    let from_bridge = out.join("from-bridge");
    assert_eq!(on_disk(&from_bridge), expected);
    let bridge_tree = helper(&json!({"op": "tree", "root": text(&from_bridge)}));
    assert_eq!(listed(&bridge_tree["tree"]["files"]), expected);
    // Listing history opens its lock, which adds the lock files; so it comes last.
    assert_eq!(version_count(&from_bridge), 1);
    println!("native {native_sha} and bridge {bridge_sha} backups both restored exactly");
}
