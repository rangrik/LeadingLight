//! The Codex adapter.
//!
//! Unit tests use synthetic folders, stand-in files that are never run, and a scripted app-server
//! over pipes. `qualification_pinned_codex_through_the_production_adapter`, ignored by default, runs
//! the pinned Codex binary through this exact adapter against a loopback fixture, with a dummy key
//! and no network; `docs/leadinglight/adapt-provider.md` says how to run it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::check::{ATTACHMENT_BYTES, PAYLOAD_BYTES, REQUEST_BYTES};
use super::codex::controls::{self, MODEL, PINNED_VERSION};
use super::codex::guard::{self, Expected, Reported};
use super::codex::loopback::{self, Answer, Loopback};
use super::codex::process::{self, Discovery, Layout, Pin, Process};
use super::codex::rpc::{Connection, MAX_LINE_BYTES};
use super::codex::session::{self, Expect, Halt, StopCause, TurnEnd, Verdict};
use super::codex::{Codex, CodexProvider, ModelProvider, Settings};
use super::prompt::{self, Payload};
use super::provider::{Provider, TurnControl, TurnOutcome};
use super::wire::{
    Attachment, AttachmentKind, CancelConnectReply, ConnectRefusal, ConnectReply,
    DisconnectRefusal, DisconnectReply, Failure, LastConnect, ProviderState, Reply, TurnPhase,
    UnavailableReason,
};
use crate::leadinglight_extensions::wire::ImportReply;
use crate::leadinglight_extensions::Extensions;

/// A minimal reply for the protocol tests. It checks reply framing only: `{}` is no package.
const ANSWER: &str = r#"{"kind":"candidate","message":"Here is a weekly review.","packageText":"{}","choices":[],"alternative":null}"#;
const UNSUPPORTED: &str = r#"{"kind":"unsupported","message":"Packages cannot change other files.","packageText":null,"choices":[],"alternative":null}"#;
const REQUEST: &str = "A weekly review with three questions";

fn candidate() -> TurnOutcome {
    TurnOutcome::Reply(Reply::Candidate {
        message: "Here is a weekly review.".to_string(),
        package_text: "{}".to_string(),
    })
}

fn failed(reason: Failure) -> TurnOutcome {
    TurnOutcome::Failed {
        reason,
        resets_at: None,
    }
}

const QUICK_NOTE_MESSAGE: &str = "Here is a quick note recipe.";

/// A complete, valid E1 package from the shared conformance corpus: a tiny recipe under an
/// ordinary `local.` id that asks for a topic and creates a note.
fn quick_note_package() -> String {
    let corpus =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/leadinglight/extensions/fixtures");
    fs::read_to_string(corpus.join("quick-note.json")).unwrap()
}

/// The canned answer the benign qualification gets: one candidate carrying that package.
fn quick_note_answer() -> String {
    json!({
        "kind": "candidate",
        "message": QUICK_NOTE_MESSAGE,
        "packageText": quick_note_package(),
        "choices": [],
        "alternative": null,
    })
    .to_string()
}

fn quick_note_candidate() -> TurnOutcome {
    TurnOutcome::Reply(Reply::Candidate {
        message: QUICK_NOTE_MESSAGE.to_string(),
        package_text: quick_note_package(),
    })
}

/// The package id, if the native E1 admission (the same validator a real import uses) accepts
/// this package text as a candidate. It stores only into a temporary folder.
fn admitted_package_id(package_text: &str) -> Option<String> {
    let dir = tempfile::tempdir().unwrap();
    match Extensions::new(dir.path().join("extensions")).import(package_text) {
        ImportReply::Candidate { package_id, .. } => Some(package_id),
        _ => None,
    }
}

/// The canned benign answer is read as one candidate whose package the native E1 admission
/// accepts, so the qualification's benign turn proves a usable candidate, not only framing.
#[test]
fn the_canned_benign_answer_is_a_candidate_the_e1_admission_accepts() {
    let reply = prompt::read_answer(&quick_note_answer()).unwrap();
    assert_eq!(TurnOutcome::Reply(reply.clone()), quick_note_candidate());
    let Reply::Candidate { package_text, .. } = reply else {
        panic!("not a candidate");
    };
    assert_eq!(
        admitted_package_id(&package_text).as_deref(),
        Some("local.quick-note")
    );
    assert_eq!(admitted_package_id("{}"), None);
}

fn recording_control() -> (Arc<TurnControl>, Arc<Mutex<Vec<TurnPhase>>>) {
    let phases = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&phases);
    let control = TurnControl::new(Box::new(move |phase| log.lock().unwrap().push(phase)));
    (Arc::new(control), phases)
}

fn pin_of(path: &Path) -> Pin {
    Pin {
        sha256: process::sha256_file(path).unwrap(),
        bytes: fs::metadata(path).unwrap().len(),
    }
}

/// Whether `pid` is still a running process, not a zombie.
fn running_pid(pid: u32) -> bool {
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

// --- The process -----------------------------------------------------------------------------

fn output_of(mut process: Process, stdout: std::process::ChildStdout) -> String {
    let mut output = String::new();
    BufReader::new(stdout).read_to_string(&mut output).unwrap();
    assert!(process.end());
    output
}

/// The provider gets exactly the fixed variables, all inside LeadingLight's private folders, and
/// the empty working folder, which is not the vault. Nothing near the vault reaches it.
#[test]
fn the_provider_sees_only_its_fixed_environment_in_the_empty_working_folder() {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(&vault).unwrap();
    fs::write(vault.join("AGENTS.md"), "SECRET-INSTRUCTIONS").unwrap();
    fs::write(vault.join(".env"), "OPENAI_API_KEY=SECRET-KEY").unwrap();
    let layout = Layout::prepare(&dir.path().join("adapt/provider/codex")).unwrap();

    let command = process::command(Path::new("/usr/bin/env"), &layout, &[], &[]);
    let (process, stdin, stdout) = Process::spawn(command).unwrap();
    drop(stdin);
    let output = output_of(process, stdout);
    let seen: BTreeMap<String, String> = output
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    let expected: BTreeSet<String> = process::environment(&layout)
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    assert_eq!(seen.keys().cloned().collect::<BTreeSet<_>>(), expected);
    for key in ["HOME", "CODEX_HOME", "TMPDIR"] {
        assert!(Path::new(&seen[key]).starts_with(layout.root()), "{key}");
    }
    assert_eq!(seen["CODEX_HOME"], layout.codex_home().to_string_lossy());
    assert_ne!(Some(seen["HOME"].clone()), std::env::var("HOME").ok());
    assert!(!output.contains("SECRET"));
    assert!(!output.contains(&*vault.to_string_lossy()));

    let extra: [(String, std::ffi::OsString); 1] = [("LL_EXTRA".to_string(), "1".into())];
    let command = process::command(Path::new("/usr/bin/env"), &layout, &[], &extra);
    let (process, stdin, stdout) = Process::spawn(command).unwrap();
    drop(stdin);
    assert!(output_of(process, stdout)
        .lines()
        .any(|line| line == "LL_EXTRA=1"));

    let command = process::command(Path::new("/bin/pwd"), &layout, &["-P".to_string()], &[]);
    let (process, stdin, stdout) = Process::spawn(command).unwrap();
    drop(stdin);
    assert_eq!(
        PathBuf::from(output_of(process, stdout).trim()),
        layout.run()
    );
    assert_eq!(fs::read_dir(layout.run()).unwrap().count(), 0);
}

/// Ending the provider kills everything it started, proves the group gone, then reaps it.
#[test]
fn ending_the_provider_ends_its_whole_group_and_proves_it() {
    let dir = tempfile::tempdir().unwrap();
    let layout = Layout::prepare(&dir.path().join("provider")).unwrap();
    let script = "/bin/sleep 60 & echo $!; wait".to_string();
    let command = process::command(
        Path::new("/bin/sh"),
        &layout,
        &["-c".to_string(), script],
        &[],
    );
    let (mut process, _stdin, stdout) = Process::spawn(command).unwrap();
    let mut line = String::new();
    BufReader::new(stdout).read_line(&mut line).unwrap();
    let started: u32 = line.trim().parse().unwrap();
    let group = process.id();
    assert!(running_pid(started));
    assert!(process.end());
    assert_eq!(process::group_running(group), Some(false));
    assert!(!running_pid(started));
}

/// A group that cannot be proven gone is reported so within the bound, and its provider is not
/// reaped until it is.
#[test]
fn an_unproven_group_end_is_reported_within_its_bound() {
    let dir = tempfile::tempdir().unwrap();
    let layout = Layout::prepare(&dir.path().join("provider")).unwrap();
    let command = process::command(Path::new("/bin/sleep"), &layout, &["30".to_string()], &[]);
    let (mut process, _stdin, _stdout) = Process::spawn(command).unwrap();
    let bound = Duration::from_millis(200);
    let started = Instant::now();
    assert!(!process.end_with(&|_| Some(true), bound));
    assert!(!process.end_with(&|_| None, bound));
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(process.end());
}

// --- Finding the pinned build ----------------------------------------------------------------

/// A stand-in file pinned by its own hash. Not executable: nothing can ever run it.
struct StandIn {
    dir: tempfile::TempDir,
    root: PathBuf,
    binary: PathBuf,
}

fn stand_in() -> StandIn {
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("bin").join("codex");
    fs::create_dir_all(binary.parent().unwrap()).unwrap();
    fs::write(
        &binary,
        b"LeadingLight stand-in for the pinned build; never run",
    )
    .unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o644)).unwrap();
    StandIn {
        root: dir.path().join("adapt/provider/codex"),
        binary,
        dir,
    }
}

/// The app's controls with the stand-in pinned, and the temporary folder as the person's home, so
/// nothing above it is looked at.
fn pinned_codex(stand: &StandIn) -> Arc<Codex> {
    let settings = Settings {
        candidates: vec![stand.binary.clone()],
        pin: pin_of(&stand.binary),
        boundary: Some(stand.dir.path().canonicalize().unwrap()),
        managed: Vec::new(),
        model: MODEL.to_string(),
        provider: None,
        extra_env: Vec::new(),
    };
    Arc::new(Codex::with(stand.root.clone(), settings))
}

fn script_at(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn only_the_pinned_build_is_found_and_nothing_else_is_ever_run() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("started");
    let launcher = dir.path().join("codex");
    script_at(
        &launcher,
        &format!("#!/bin/sh\n/usr/bin/touch {}\n", marker.display()),
    );
    let pinned = dir.path().join("pinned");
    fs::write(&pinned, b"LL-PINNED-STAND-IN").unwrap();
    let same_size = dir.path().join("same-size");
    fs::write(&same_size, b"LL-OTHER--STAND-IN").unwrap();
    let link = dir.path().join("link");
    std::os::unix::fs::symlink(&pinned, &link).unwrap();
    let pin = pin_of(&pinned);
    let missing = dir.path().join("missing");

    assert_eq!(
        process::discover(std::slice::from_ref(&missing), &pin),
        Discovery::Missing
    );
    assert_eq!(
        process::discover(std::slice::from_ref(&launcher), &pin),
        Discovery::Unpinned
    );
    assert_eq!(process::discover(&[same_size], &pin), Discovery::Unpinned);
    let Discovery::Pinned(found) = process::discover(&[launcher.clone(), pinned.clone()], &pin)
    else {
        panic!("the pinned stand-in was not found");
    };
    assert_eq!(found.path, pinned.canonicalize().unwrap());
    assert!(found.unchanged());
    let Discovery::Pinned(through_link) = process::discover(&[link], &pin) else {
        panic!("a link to the pinned stand-in was not followed");
    };
    assert_eq!(through_link.path, found.path);
    fs::write(pinned, b"LL-CHANGED-STAND-IN").unwrap();
    assert!(!found.unchanged());

    // Another build is reported and never started: not for status, sign-in, sign-out or a turn.
    let root = dir.path().join("adapt/provider/codex");
    let other = Arc::new(Codex::for_test(
        root.clone(),
        vec![launcher],
        Pin::qualified(),
    ));
    let provider = CodexProvider(Arc::clone(&other));
    let unsupported = ProviderState::Unavailable {
        reason: UnavailableReason::UnsupportedVersion,
        installed_version: None,
    };
    assert_eq!(provider.snapshot().state, unsupported);
    assert_eq!(
        provider.connect(&|_: &str| true),
        ConnectReply::Refused {
            reason: ConnectRefusal::Unavailable
        }
    );
    let payload = prompt::build(REQUEST, &[], &[], None);
    let (control, _) = recording_control();
    assert_eq!(
        provider.run_turn(&payload, &control),
        failed(Failure::ProviderFailed)
    );
    assert_eq!(
        provider.disconnect(),
        DisconnectReply::Refused {
            reason: DisconnectRefusal::Unavailable
        }
    );
    assert_eq!(other.spawns(), 0);
    assert!(!marker.exists());

    let none = CodexProvider(Arc::new(Codex::for_test(
        root,
        vec![missing],
        Pin::qualified(),
    )));
    assert_eq!(
        none.snapshot().state,
        ProviderState::Unavailable {
            reason: UnavailableReason::NotInstalled,
            installed_version: None
        }
    );
}

/// The verified file is checked again whenever it changes; a changed file is another build.
#[test]
fn the_pinned_build_is_verified_again_when_it_changes() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let first = provider.snapshot();
    assert_eq!(first.state, ProviderState::SignedOut { last_connect: None });
    assert_eq!(provider.snapshot().revision, first.revision);
    fs::write(
        stand.binary.as_path(),
        b"LeadingLight stand-in for another build; never run",
    )
    .unwrap();
    assert_eq!(
        provider.snapshot().state,
        ProviderState::Unavailable {
            reason: UnavailableReason::UnsupportedVersion,
            installed_version: None
        }
    );
    assert_eq!(codex.spawns(), 0);
}

#[test]
fn install_locations_are_the_npm_payload_under_known_node_prefixes_and_other_native_installs() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    fs::create_dir_all(home.join(".local/share/fnm/node-versions/v22.0.0/installation")).unwrap();
    fs::create_dir_all(home.join(".nvm/versions/node/v20.0.0")).unwrap();
    let found = process::candidates(Some(home));
    let payload = controls::NPM_PAYLOADS[0];
    for expected in [
        PathBuf::from("/opt/homebrew").join(payload),
        home.join(".local/share/fnm/node-versions/v22.0.0/installation")
            .join(payload),
        home.join(".nvm/versions/node/v20.0.0").join(payload),
        PathBuf::from("/opt/homebrew/bin/codex"),
    ] {
        assert!(found.contains(&expected), "{}", expected.display());
    }
    assert!(found.iter().all(|path| path.ends_with("codex")));
}

// --- The configuration, the preflight and the gate -------------------------------------------

#[test]
fn the_configuration_is_exactly_the_qualified_one() {
    let codex_home = Path::new("/private/adapt/home/codex");
    let run = Path::new("/private/adapt/run");
    let text = controls::config_toml(MODEL, codex_home, run, None);
    for line in [
        "model = \"gpt-5.5\"",
        "approval_policy = \"on-request\"",
        "approvals_reviewer = \"user\"",
        "default_permissions = \"adapt\"",
        "web_search = \"disabled\"",
        "project_doc_max_bytes = 0",
        "project_root_markers = []",
        "cli_auth_credentials_store = \"file\"",
        "\":root\" = \"deny\"",
        "\"/private/adapt/run\" = \"read\"",
        "[permissions.adapt.network]\nenabled = false",
    ] {
        assert!(text.contains(line), "{line}");
    }
    for feature in controls::DISABLED_FEATURES {
        assert!(
            text.contains(&format!("\n{feature} = false\n")),
            "{feature}"
        );
    }
    assert_eq!(
        text.matches("[[skills.config]]").count(),
        controls::SYSTEM_SKILLS.len()
    );
    assert!(text.contains(
        "path = \"/private/adapt/home/codex/skills/.system/imagegen/SKILL.md\"\nenabled = false"
    ));
    for absent in [
        "model_provider",
        "sandbox_mode",
        "sandbox_workspace_write",
        "[model_providers",
    ] {
        assert!(!text.contains(absent), "{absent}");
    }
    let fixture = controls::config_toml(
        MODEL,
        codex_home,
        run,
        Some(("llfake", "http://127.0.0.1:1/v1", "LL_KEY")),
    );
    assert!(fixture.contains("model_provider = \"llfake\"\n"));
    assert!(fixture.contains("[model_providers.\"llfake\"]\n"));
    assert!(fixture.contains("env_key = \"LL_KEY\"\n"));

    assert_eq!(
        controls::toml_string("a\"b\\c\nd\u{1}"),
        "\"a\\\"b\\\\c\\nd\\u0001\""
    );
    let quoted = controls::config_toml(MODEL, codex_home, Path::new("/private/a\"b"), None);
    assert!(quoted.contains("\"/private/a\\\"b\" = \"read\""));
    assert_eq!(controls::app_server_args(), ["app-server"]);

    assert_eq!(
        controls::refusal("item/fileChange/requestApproval"),
        Some(json!({ "decision": "decline" }))
    );
    assert_eq!(
        controls::refusal("item/commandExecution/requestApproval"),
        Some(json!({ "decision": "decline" }))
    );
    assert_eq!(
        controls::refusal("applyPatchApproval"),
        Some(json!({ "decision": "denied" }))
    );
    assert_eq!(
        controls::refusal("execCommandApproval"),
        Some(json!({ "decision": "denied" }))
    );
    assert_eq!(
        controls::refusal("mcpServer/elicitation/request"),
        Some(json!({ "action": "decline" }))
    );
    for method in [
        "item/tool/requestUserInput",
        "item/tool/call",
        "item/permissions/requestApproval",
    ] {
        assert_eq!(controls::refusal(method), None, "{method}");
    }
}

/// Private folders as LeadingLight writes them, under a synthetic person's home.
struct Fixture {
    dir: tempfile::TempDir,
    /// The synthetic person's own home: the boundary of the ancestry check.
    user: PathBuf,
    layout: Layout,
    binary: PathBuf,
    config: String,
    managed: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let user = dir.path().join("user");
        fs::create_dir_all(&user).unwrap();
        let user = user.canonicalize().unwrap();
        let layout =
            Layout::prepare(&user.join("Library/LeadingLight/adapt/provider/codex")).unwrap();
        let binary = dir.path().canonicalize().unwrap().join("bin/codex");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, b"pinned stand-in").unwrap();
        let config = controls::config_toml(MODEL, &layout.codex_home(), &layout.run(), None);
        fs::write(layout.config_file(), &config).unwrap();
        let managed = dir.path().join("etc-codex-config.toml");
        Self {
            dir,
            user,
            layout,
            binary,
            config,
            managed,
        }
    }

    fn problems(&self) -> Vec<String> {
        let managed = [self.managed.clone()];
        guard::preflight(&Expected {
            layout: &self.layout,
            config: &self.config,
            binary: &self.binary,
            binary_id: process::file_id(&self.binary).unwrap(),
            boundary: Some(self.user.as_path()),
            managed: &managed,
        })
    }

    fn codex(&self) -> PathBuf {
        self.layout.codex_home()
    }

    fn elsewhere(&self) -> PathBuf {
        let elsewhere = self.dir.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        elsewhere
    }

    /// The runtime's own helper layout, as the pinned build leaves it after a start.
    fn helpers(&self) -> PathBuf {
        let folder = self.codex().join("tmp/arg0/codex-arg0Ab12Cd");
        helper_layout(&folder, &self.binary);
        folder
    }
}

fn helper_layout(folder: &Path, binary: &Path) {
    fs::create_dir_all(folder).unwrap();
    fs::write(folder.join(".lock"), b"").unwrap();
    for helper in controls::HELPER_LINKS {
        std::os::unix::fs::symlink(binary, folder.join(helper)).unwrap();
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn relink(link: &Path, target: &Path) {
    fs::remove_file(link).unwrap();
    std::os::unix::fs::symlink(target, link).unwrap();
}

type Contaminate = fn(&Fixture);

/// Each contamination of the private folders or the working folder's ancestry is refused before
/// anything starts; the person's own home above them is not looked at.
#[test]
fn the_preflight_admits_only_the_private_folders_as_written() {
    let clean = Fixture::new();
    assert_eq!(clean.problems(), Vec::<String>::new());
    // The person's own home is the boundary: what is in it is not consulted, so not refused.
    write(&clean.user.join("AGENTS.md"), "LLCANARY");
    write(
        &clean.user.join(".codex/config.toml"),
        "developer_instructions = \"LLCANARY\"\n",
    );
    write(&clean.user.join(".agents/skills/x/SKILL.md"), "LLCANARY");
    assert_eq!(clean.problems(), Vec::<String>::new());

    let cases: Vec<(&str, Contaminate)> = vec![
        ("global instructions", |f| {
            write(&f.codex().join("AGENTS.md"), "LLCANARY")
        }),
        ("global override", |f| {
            write(&f.codex().join("AGENTS.override.md"), "LLCANARY")
        }),
        ("user skill", |f| {
            write(&f.codex().join("skills/x/SKILL.md"), "LLCANARY")
        }),
        ("agents skill", |f| {
            write(
                &f.layout.home().join(".agents/skills/x/SKILL.md"),
                "LLCANARY",
            )
        }),
        ("hooks", |f| write(&f.codex().join("hooks.json"), "{}")),
        ("plugin", |f| {
            write(&f.codex().join("plugins/x/.codex-plugin/plugin.json"), "{}")
        }),
        ("memories", |f| {
            write(&f.codex().join("memories/MEMORY.md"), "LLCANARY")
        }),
        ("prompts", |f| {
            write(&f.codex().join("prompts/x.md"), "LLCANARY")
        }),
        ("edited configuration", |f| {
            let config = f.layout.config_file();
            let text = fs::read_to_string(&config).unwrap();
            fs::write(config, text + "developer_instructions = \"LLCANARY\"\n").unwrap();
        }),
        ("configuration in the private home", |f| {
            write(
                &f.layout.home().join(".codex/config.toml"),
                "developer_instructions = \"LLCANARY\"\n",
            )
        }),
        ("instructions in the working folder", |f| {
            write(&f.layout.run().join("AGENTS.md"), "LLCANARY")
        }),
        ("any file in the working folder", |f| {
            write(&f.layout.run().join("note.txt"), "x")
        }),
        ("skill in the working folder", |f| {
            write(
                &f.layout.run().join(".agents/skills/x/SKILL.md"),
                "LLCANARY",
            )
        }),
        ("linked skills", |f| {
            std::os::unix::fs::symlink(f.elsewhere(), f.codex().join("skills")).unwrap()
        }),
        ("instructions above the working folder", |f| {
            write(&f.user.join("Library/LeadingLight/AGENTS.md"), "LLCANARY")
        }),
        ("project folder above the working folder", |f| {
            fs::create_dir_all(f.user.join("Library/.codex")).unwrap()
        }),
        ("linked temporary folder", |f| {
            fs::remove_dir_all(f.layout.tmp()).unwrap();
            std::os::unix::fs::symlink(f.elsewhere(), f.layout.tmp()).unwrap();
        }),
        ("machine-wide configuration", |f| {
            write(&f.managed, "model = \"other\"\n")
        }),
    ];
    for (name, contaminate) in cases {
        let fixture = Fixture::new();
        assert_eq!(fixture.problems(), Vec::<String>::new(), "{name}");
        contaminate(&fixture);
        assert!(!fixture.problems().is_empty(), "{name} was admitted");
    }
}

type ContaminateHelpers = fn(&Fixture, &Path);

/// The runtime's own helper links are admitted only exactly as the pinned build makes them.
#[test]
fn only_the_runtimes_own_helper_links_are_admitted() {
    let fixture = Fixture::new();
    fixture.helpers();
    assert_eq!(fixture.problems(), Vec::<String>::new());

    let cases: Vec<(&str, ContaminateHelpers)> = vec![
        ("to the system shell", |_, d| {
            relink(&d.join("apply_patch"), Path::new("/bin/sh"))
        }),
        ("to a foreign file", |f, d| {
            let secret = f.elsewhere().join("secret.txt");
            fs::write(&secret, "LLCANARY").unwrap();
            relink(&d.join("codex-execve-wrapper"), &secret);
        }),
        ("to another Codex", |f, d| {
            let other = f.elsewhere().join("codex");
            fs::write(&other, b"another build").unwrap();
            relink(&d.join("apply_patch"), &other);
        }),
        ("relative text to the pinned build", |f, d| {
            let relative = pathdiff(&f.binary, d);
            relink(&d.join("applypatch"), &relative);
        }),
        ("unexpected name", |f, d| {
            std::os::unix::fs::symlink(&f.binary, d.join("codex")).unwrap()
        }),
        ("outside the helper layout", |f, _| {
            std::os::unix::fs::symlink(&f.binary, f.codex().join("tmp/apply_patch")).unwrap()
        }),
        ("linked helper folder", |f, d| {
            let elsewhere = f.elsewhere().join("codex-arg0Zz99Yy");
            helper_layout(&elsewhere, &f.binary);
            fs::remove_dir_all(d).unwrap();
            std::os::unix::fs::symlink(elsewhere, d).unwrap();
        }),
        ("regular file helper", |_, d| {
            fs::remove_file(d.join("applypatch")).unwrap();
            fs::write(d.join("applypatch"), "#!/bin/sh\ncat /etc/hosts\n").unwrap();
        }),
        ("malformed folder name", |_, d| {
            fs::rename(d, d.with_file_name("codex-arg0TooLong7")).unwrap()
        }),
        ("lock with content", |_, d| {
            fs::write(d.join(".lock"), "x").unwrap()
        }),
    ];
    for (name, contaminate) in cases {
        let fixture = Fixture::new();
        let folder = fixture.helpers();
        assert_eq!(fixture.problems(), Vec::<String>::new(), "{name}");
        contaminate(&fixture, &folder);
        assert!(!fixture.problems().is_empty(), "{name} was admitted");
    }
}

/// `target` as a path relative to `from`.
fn pathdiff(target: &Path, from: &Path) -> PathBuf {
    let from: Vec<_> = from.components().collect();
    let target: Vec<_> = target.components().collect();
    let common = from.iter().zip(&target).take_while(|(a, b)| a == b).count();
    let mut relative = PathBuf::new();
    for _ in common..from.len() {
        relative.push("..");
    }
    for part in &target[common..] {
        relative.push(part.as_os_str());
    }
    relative
}

/// What the pinned runtime reports for LeadingLight's configuration.
fn clean_report(layout: &Layout, model_provider: Option<&str>) -> Reported {
    let features: serde_json::Map<String, Value> = controls::DISABLED_FEATURES
        .iter()
        .map(|name| (name.to_string(), Value::Bool(false)))
        .collect();
    let skills: Vec<Value> = controls::SYSTEM_SKILLS
        .iter()
        .map(|name| json!({ "name": name, "scope": "system", "enabled": false }))
        .collect();
    let mut effective = json!({
        "model": MODEL,
        "default_permissions": "adapt",
        "sandbox_mode": null,
        "approval_policy": "on-request",
        "approvals_reviewer": "user",
        "web_search": "disabled",
        "cli_auth_credentials_store": "file",
        "project_root_markers": [],
        "project_doc_max_bytes": 0,
        "features": features,
    });
    if let Some(provider) = model_provider {
        effective["model_provider"] = json!(provider);
    }
    Reported {
        requirements: json!({ "requirements": null }),
        config: json!({
            "layers": [
                { "name": { "type": "user", "file": layout.config_file() } },
                { "name": { "type": "system", "file": "/etc/codex/config.toml" }, "config": {} },
            ],
            "config": effective,
        }),
        skills: json!({ "data": [{ "skills": skills, "errors": [] }] }),
        hooks: json!({ "data": [{ "hooks": [], "warnings": [], "errors": [] }] }),
        plugins: json!({ "marketplaces": [], "featuredPluginIds": [] }),
        mcp_servers: json!({ "data": [], "nextCursor": null }),
        warnings: Vec::new(),
    }
}

type ChangeReport = fn(&mut Reported);

#[test]
fn the_gate_admits_only_the_qualified_configuration_as_the_runtime_reports_it() {
    let fixture = Fixture::new();
    let layout = &fixture.layout;
    assert_eq!(
        guard::gate(&clean_report(layout, None), layout, "openai"),
        Vec::<String>::new()
    );
    assert_eq!(
        guard::gate(&clean_report(layout, Some("openai")), layout, "openai"),
        Vec::<String>::new()
    );
    assert_eq!(
        guard::gate(&clean_report(layout, Some("llfake")), layout, "llfake"),
        Vec::<String>::new()
    );
    assert!(!guard::gate(&clean_report(layout, None), layout, "llfake").is_empty());

    let cases: Vec<(&str, ChangeReport)> = vec![
        ("a warning", |r| {
            r.warnings.push("configWarning".to_string())
        }),
        ("requirements", |r| {
            r.requirements = json!({ "requirements": { "allowedSandboxModes": [] } })
        }),
        ("a project layer", |r| {
            let layers = r.config["layers"].as_array_mut().unwrap();
            layers.insert(
                0,
                json!({ "name": { "type": "project", "dotCodexFolder": "/elsewhere/.codex" } }),
            );
        }),
        ("another user file", |r| {
            r.config["layers"][0]["name"]["file"] = json!("/elsewhere/config.toml")
        }),
        ("a system setting", |r| {
            r.config["layers"][1]["config"] = json!({ "model": "other" })
        }),
        ("another model", |r| {
            r.config["config"]["model"] = json!("gpt-5.4")
        }),
        ("another provider", |r| {
            r.config["config"]["model_provider"] = json!("other")
        }),
        ("a legacy sandbox", |r| {
            r.config["config"]["sandbox_mode"] = json!("workspace-write")
        }),
        ("no approvals", |r| {
            r.config["config"]["approval_policy"] = json!("never")
        }),
        ("another reviewer", |r| {
            r.config["config"]["approvals_reviewer"] = json!("auto_review")
        }),
        ("keyring credentials", |r| {
            r.config["config"]["cli_auth_credentials_store"] = json!("keyring")
        }),
        ("project markers", |r| {
            r.config["config"]["project_root_markers"] = json!([".git"])
        }),
        ("a feature left on", |r| {
            r.config["config"]["features"]["hooks"] = json!(true)
        }),
        ("a feature not reported", |r| {
            r.config["config"]["features"]
                .as_object_mut()
                .unwrap()
                .remove("plugins");
        }),
        ("an enabled skill", |r| {
            r.skills["data"][0]["skills"][0]["enabled"] = json!(true)
        }),
        ("a user skill", |r| {
            let skills = r.skills["data"][0]["skills"].as_array_mut().unwrap();
            skills.push(json!({ "name": "mine", "scope": "user", "enabled": false }));
        }),
        ("a hook", |r| {
            r.hooks["data"][0]["hooks"] = json!([{ "event": "preToolUse" }])
        }),
        ("a plugin marketplace", |r| {
            r.plugins["marketplaces"] = json!([{ "name": "x" }])
        }),
        ("an MCP server", |r| {
            r.mcp_servers["data"] = json!([{ "name": "x" }])
        }),
    ];
    for (name, change) in cases {
        let mut reported = clean_report(layout, None);
        change(&mut reported);
        assert!(
            !guard::gate(&reported, layout, "openai").is_empty(),
            "{name} was admitted"
        );
    }
}

// --- A scripted app-server -------------------------------------------------------------------

/// In a scripted reply list: the server closes its output instead of sending more.
const CLOSE: &str = "close-the-stream";
/// In a scripted reply list: the server stops reading its input until released.
const STALL: &str = "stop-reading";

type Log = Arc<Mutex<Vec<Value>>>;

struct Served {
    connection: Connection,
    log: Log,
    release: mpsc::Sender<()>,
    server: JoinHandle<()>,
}

impl Served {
    /// Everything the client wrote, once it has gone.
    fn finish(self) -> Vec<Value> {
        let Served {
            connection,
            log,
            release,
            server,
        } = self;
        drop(connection);
        let _ = release.send(());
        server.join().unwrap();
        let mut seen = Vec::new();
        seen.extend(log.lock().unwrap().iter().cloned());
        seen
    }
}

/// A scripted app-server over pipes: each client line is logged and answered by `script`.
///
/// It logs every line the client wrote, until the client's input ends. Once the client has stopped
/// reading (a reply fails to write), the server stops writing but keeps reading. Otherwise a write
/// racing the client's shutdown would end the server before it read lines the client had already
/// written, such as a refusal sent just before the client went away.
fn serve(mut script: impl FnMut(&Value, &mut Vec<Value>) + Send + 'static) -> Served {
    let (client_reads, server_writes) = std::io::pipe().unwrap();
    let (server_reads, client_writes) = std::io::pipe().unwrap();
    let log: Log = Arc::default();
    let seen = Arc::clone(&log);
    let (release, released) = mpsc::channel::<()>();
    let server = std::thread::spawn(move || {
        let mut server_writes = Some(server_writes);
        for line in BufReader::new(server_reads).lines() {
            let Ok(line) = line else {
                return;
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                return;
            };
            seen.lock().unwrap().push(message.clone());
            let mut replies = Vec::new();
            script(&message, &mut replies);
            for reply in replies {
                if reply == CLOSE {
                    return;
                }
                if reply == STALL {
                    let _ = released.recv();
                    continue;
                }
                let written = server_writes
                    .as_mut()
                    .is_some_and(|writer| writeln!(writer, "{reply}").is_ok());
                if !written {
                    server_writes = None;
                }
            }
        }
    });
    Served {
        connection: Connection::new(client_reads, client_writes),
        log,
        release,
        server,
    }
}

fn notification(method: &str, params: Value) -> Value {
    json!({ "method": method, "params": params })
}

fn turn_completed(thread: &str, turn: &str, status: &str, error: Value) -> Value {
    notification(
        "turn/completed",
        json!({ "threadId": thread, "turn": { "id": turn, "items": [], "status": status, "error": error } }),
    )
}

fn completed(status: &str, error: Value) -> Value {
    turn_completed("thread-1", "turn-1", status, error)
}

fn message(text: &str, phase: &str) -> Value {
    notification(
        "item/completed",
        json!({ "threadId": "thread-1", "turnId": "turn-1", "item": { "type": "agentMessage", "id": "item-1", "text": text, "phase": phase } }),
    )
}

fn turn_started() -> Value {
    notification(
        "turn/started",
        json!({ "threadId": "thread-1", "turn": { "id": "turn-1" } }),
    )
}

fn item(kind: &str) -> Value {
    notification(
        "item/started",
        json!({ "threadId": "thread-1", "turnId": "turn-1", "item": { "type": kind, "id": "call-1" } }),
    )
}

fn provider_request(method: &str) -> Value {
    json!({ "id": "provider-1", "method": method, "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "call-1" } })
}

fn answered(text: &str) -> Vec<Value> {
    vec![
        turn_started(),
        message(text, "final_answer"),
        completed("completed", Value::Null),
    ]
}

/// A candidate that arrives after the host stopped the turn. It must never be admitted.
fn late_answer() -> Vec<Value> {
    answered(ANSWER)
}

fn thread_ok(params: &Value) -> Value {
    json!({
        "thread": { "id": "thread-1" },
        "model": MODEL,
        "modelProvider": "openai",
        "cwd": params["cwd"],
        "instructionSources": [],
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "sandbox": { "type": "readOnly", "networkAccess": false },
        "activePermissionProfile": { "id": "adapt", "extends": null },
    })
}

/// How the scripted server answers `turn/interrupt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Interrupt {
    /// The empty-object reply, then `turn/completed` interrupted for exactly this turn.
    Matching,
    /// The reply only.
    AckOnly,
    /// The reply, then interrupted completions of another turn and another thread.
    Unrelated,
    /// An error reply.
    Refused,
}

type ThreadReply = Box<dyn Fn(&Value) -> Value + Send>;

struct Script {
    thread: ThreadReply,
    /// Sent while the thread starts, before its reply.
    while_starting: Vec<Value>,
    /// Sent once the turn is accepted.
    events: Vec<Value>,
    interrupt: Interrupt,
    /// Sent after the interrupt's reply.
    after_interrupt: Vec<Value>,
    /// Stop reading right after the thread starts.
    stall_after_thread: bool,
}

impl Script {
    fn new(events: Vec<Value>) -> Self {
        Self {
            thread: Box::new(thread_ok),
            while_starting: Vec::new(),
            events,
            interrupt: Interrupt::Matching,
            after_interrupt: Vec::new(),
            stall_after_thread: false,
        }
    }

    fn reply(&self, request: &Value, replies: &mut Vec<Value>) {
        let id = request.get("id").cloned();
        let ok = |result: Value| json!({ "id": id, "result": result });
        match request.get("method").and_then(Value::as_str) {
            Some("initialize") => replies.push(ok(json!({
                "userAgent": "test", "codexHome": "/private", "platformFamily": "unix", "platformOs": "macos"
            }))),
            Some(
                "configRequirements/read" | "config/read" | "skills/list" | "hooks/list"
                | "plugin/list" | "mcpServerStatus/list" | "account/logout",
            ) => replies.push(ok(json!({}))),
            Some("thread/start") => {
                replies.extend(self.while_starting.iter().cloned());
                replies.push(ok((self.thread)(&request["params"])));
                if self.stall_after_thread {
                    replies.push(json!(STALL));
                }
            }
            Some("turn/start") => {
                replies.push(ok(json!({ "turn": { "id": "turn-1", "items": [], "status": "inProgress" } })));
                replies.extend(self.events.iter().cloned());
            }
            Some("turn/interrupt") => {
                if self.interrupt == Interrupt::Refused {
                    replies.push(json!({ "id": id, "error": { "code": -32600, "message": "no active turn" } }));
                } else {
                    replies.push(ok(json!({})));
                }
                match self.interrupt {
                    Interrupt::Matching => replies.push(completed("interrupted", Value::Null)),
                    Interrupt::Unrelated => {
                        replies.push(turn_completed("thread-1", "turn-2", "interrupted", Value::Null));
                        replies.push(turn_completed("thread-2", "turn-1", "interrupted", Value::Null));
                    }
                    Interrupt::AckOnly | Interrupt::Refused => {}
                }
                replies.extend(self.after_interrupt.iter().cloned());
            }
            Some(_) if id.is_some() => {
                replies.push(json!({ "id": id, "error": { "code": -32601, "message": "unknown" } }))
            }
            _ => {}
        }
    }
}

fn app_server(script: Script) -> Served {
    serve(move |request, replies| script.reply(request, replies))
}

fn admit_all(_: &Reported) -> Vec<String> {
    Vec::new()
}

struct Ran {
    end: TurnEnd,
    seen: Vec<Value>,
    phases: Vec<TurnPhase>,
    payload: Payload,
}

fn run_with(script: Script, admit: &dyn Fn(&Reported) -> Vec<String>) -> Ran {
    let dir = tempfile::tempdir().unwrap();
    let payload = prompt::build(REQUEST, &[], &[], None);
    let mut served = app_server(script);
    let (control, phases) = recording_control();
    let expect = Expect {
        run_dir: dir.path(),
        model_provider: "openai",
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    let end = session::run_turn(
        &mut served.connection,
        &payload,
        &expect,
        admit,
        &control,
        deadline,
    );
    let seen = served.finish();
    let phases = phases.lock().unwrap().clone();
    Ran {
        end,
        seen,
        phases,
        payload,
    }
}

fn run(script: Script) -> Ran {
    run_with(script, &admit_all)
}

fn method_of(message: &Value) -> Option<&str> {
    message.get("method").and_then(Value::as_str)
}

fn methods(seen: &[Value]) -> Vec<&str> {
    seen.iter().filter_map(method_of).collect()
}

fn sent_text(seen: &[Value]) -> String {
    seen.iter().map(Value::to_string).collect()
}

/// The client's answer to the provider's request, if it wrote one.
fn answer_to_provider(seen: &[Value]) -> Option<(usize, &Value)> {
    seen.iter()
        .enumerate()
        .find(|(_, message)| message["id"] == "provider-1" && method_of(message).is_none())
}

fn position(seen: &[Value], method: &str) -> Option<usize> {
    seen.iter()
        .position(|message| method_of(message) == Some(method))
}

// --- The conversation ------------------------------------------------------------------------

#[test]
fn a_turn_sends_its_payload_only_after_the_gate_and_a_proven_thread_and_reads_one_reply() {
    let ran = run(Script::new(answered(ANSWER)));
    assert_eq!(ran.end.outcome, candidate());
    assert_eq!(ran.end.verdict, Verdict::Clean);
    assert_eq!(ran.end.stop, None);
    assert_eq!(ran.phases, [TurnPhase::Working, TurnPhase::Checking]);
    assert_eq!(
        methods(&ran.seen),
        [
            "initialize",
            "initialized",
            "configRequirements/read",
            "config/read",
            "skills/list",
            "hooks/list",
            "plugin/list",
            "mcpServerStatus/list",
            "thread/start",
            "turn/start"
        ]
    );
    assert_eq!(
        ran.seen[0]["params"]["capabilities"],
        json!({ "experimentalApi": true })
    );
    // Nothing overrides the qualified configuration per thread or per turn.
    let thread = &ran.seen[8]["params"];
    let keys: BTreeSet<&str> = thread
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        BTreeSet::from(["baseInstructions", "cwd", "ephemeral"])
    );
    assert_eq!(thread["ephemeral"], true);
    assert_eq!(
        thread["baseInstructions"],
        ran.payload.instructions.as_str()
    );
    assert!(!thread.to_string().contains(REQUEST));
    let turn = &ran.seen[9]["params"];
    let keys: BTreeSet<&str> = turn
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, BTreeSet::from(["input", "outputSchema", "threadId"]));
    assert_eq!(turn["threadId"], "thread-1");
    assert_eq!(turn["input"][0]["text"], ran.payload.message.as_str());
    assert_eq!(turn["outputSchema"], ran.payload.output_schema);
    let before_turn = sent_text(&ran.seen[..9]);
    assert!(!before_turn.contains(REQUEST));
}

/// What the gate refuses, and any warning before the turn, keeps every word of the request home.
#[test]
fn nothing_is_sent_when_the_gate_refuses_or_the_runtime_warns() {
    let refuse = |_: &Reported| vec!["contaminated".to_string()];
    let ran = run_with(Script::new(answered(ANSWER)), &refuse);
    assert_eq!(ran.end.outcome, failed(Failure::ProviderFailed));
    assert_eq!(ran.end.verdict, Verdict::Contaminated);
    assert_eq!(position(&ran.seen, "thread/start"), None);
    assert!(!sent_text(&ran.seen).contains(REQUEST));

    let warned = |reported: &Reported| reported.warnings.clone();
    let mut script = Script::new(answered(ANSWER));
    script.while_starting = vec![notification(
        "warning",
        json!({ "message": "model metadata not found" }),
    )];
    let ran = run_with(script, &warned);
    assert_eq!(ran.end.outcome, failed(Failure::ProviderFailed));
    assert_eq!(ran.end.verdict, Verdict::Contaminated);
    assert_eq!(position(&ran.seen, "turn/start"), None);
    assert!(!sent_text(&ran.seen).contains(REQUEST));
}

type ChangeThread = fn(&mut Value);

/// A thread that is not exactly as qualified gets none of the person's text, and Codex is marked
/// as having left what was qualified.
#[test]
fn a_thread_that_is_not_exactly_as_qualified_gets_none_of_the_persons_text() {
    let cases: Vec<(&str, ChangeThread)> = vec![
        ("an instruction file", |t| {
            t["instructionSources"] = json!(["/Users/someone/AGENTS.md"])
        }),
        ("another model", |t| t["model"] = json!("gpt-5.4")),
        ("another provider", |t| t["modelProvider"] = json!("other")),
        ("network", |t| t["sandbox"]["networkAccess"] = json!(true)),
        ("a writable sandbox", |t| {
            t["sandbox"] = json!({ "type": "dangerFullAccess" })
        }),
        ("no permission profile", |t| {
            t["activePermissionProfile"] = Value::Null
        }),
        ("another permission profile", |t| {
            t["activePermissionProfile"]["id"] = json!(":workspace")
        }),
        ("another folder", |t| t["cwd"] = json!("/")),
        ("no approvals", |t| t["approvalPolicy"] = json!("never")),
        ("another reviewer", |t| {
            t["approvalsReviewer"] = json!("auto_review")
        }),
        ("no thread id", |t| t["thread"]["id"] = json!("")),
    ];
    for (name, change) in cases {
        let mut script = Script::new(answered(ANSWER));
        script.thread = Box::new(move |params: &Value| {
            let mut thread = thread_ok(params);
            change(&mut thread);
            thread
        });
        let ran = run(script);
        assert_eq!(ran.end.outcome, failed(Failure::ProviderFailed), "{name}");
        assert_eq!(ran.end.verdict, Verdict::Breach, "{name}");
        assert_eq!(position(&ran.seen, "turn/start"), None, "{name}");
        assert!(!sent_text(&ran.seen).contains(REQUEST), "{name}");
    }
}

/// A proposed patch, then its request for write authority, under each way the interrupt can go.
fn patch_attempt(interrupt: Interrupt) -> Ran {
    let mut script = Script::new(vec![
        turn_started(),
        item("fileChange"),
        provider_request("item/fileChange/requestApproval"),
    ]);
    script.interrupt = interrupt;
    script.after_interrupt = late_answer();
    run(script)
}

/// The decline is written only once this very turn both acknowledged the interrupt and ended as
/// interrupted; after it, the client writes nothing that could continue or repeat the turn.
#[test]
fn a_patch_request_is_declined_only_after_its_own_turn_is_confirmed_interrupted() {
    let ran = patch_attempt(Interrupt::Matching);
    assert_eq!(ran.end.outcome, failed(Failure::ToolRefused));
    assert_eq!(ran.end.verdict, Verdict::Clean);
    let stop = ran.end.stop.clone().unwrap();
    assert_eq!(stop.cause, StopCause::PatchAttempt);
    assert_eq!(stop.trigger, "item/started:fileChange");
    assert_eq!(stop.thread_id.as_deref(), Some("thread-1"));
    assert_eq!(stop.turn_id.as_deref(), Some("turn-1"));
    assert!(stop.interrupt_sent && stop.interrupt_acknowledged && stop.turn_interrupted);
    assert_eq!(stop.refused, ["item/fileChange/requestApproval"]);
    assert!(stop.unanswered.is_empty());
    let interrupt = position(&ran.seen, "turn/interrupt").unwrap();
    assert_eq!(
        ran.seen[interrupt]["params"],
        json!({ "threadId": "thread-1", "turnId": "turn-1" })
    );
    let (decline, answer) = answer_to_provider(&ran.seen).unwrap();
    assert_eq!(answer["result"], json!({ "decision": "decline" }));
    assert!(interrupt < decline);
    assert_eq!(
        decline,
        ran.seen.len() - 1,
        "the client wrote after the decline"
    );
    assert_eq!(
        methods(&ran.seen)
            .iter()
            .filter(|m| **m == "turn/start")
            .count(),
        1
    );

    for interrupt in [Interrupt::AckOnly, Interrupt::Unrelated, Interrupt::Refused] {
        let ran = patch_attempt(interrupt);
        assert_eq!(
            ran.end.outcome,
            failed(Failure::ToolRefused),
            "{interrupt:?}"
        );
        let stop = ran.end.stop.clone().unwrap();
        assert!(stop.interrupt_sent, "{interrupt:?}");
        assert!(!stop.turn_interrupted, "{interrupt:?}");
        assert_eq!(
            stop.interrupt_acknowledged,
            interrupt != Interrupt::Refused,
            "{interrupt:?}"
        );
        assert_eq!(
            stop.interrupt_refused,
            interrupt == Interrupt::Refused,
            "{interrupt:?}"
        );
        assert!(stop.refused.is_empty(), "{interrupt:?}");
        assert_eq!(
            stop.unanswered,
            ["item/fileChange/requestApproval"],
            "{interrupt:?}"
        );
        assert_eq!(
            answer_to_provider(&ran.seen),
            None,
            "{interrupt:?} wrote a refusal"
        );
        let last = ran.seen.last().and_then(method_of);
        assert_eq!(
            last,
            Some("turn/interrupt"),
            "{interrupt:?}: the client wrote after the interrupt"
        );
    }
}

/// Every request gets its schema's own refusal, written only after the turn is interrupted. Only
/// a patch request is known behaviour; anything else is a breach.
#[test]
fn each_request_gets_its_own_refusal_and_only_a_patch_request_is_known_behaviour() {
    let cases = [
        (
            "item/fileChange/requestApproval",
            Some(json!({ "decision": "decline" })),
            Verdict::Clean,
        ),
        (
            "applyPatchApproval",
            Some(json!({ "decision": "denied" })),
            Verdict::Clean,
        ),
        (
            "item/commandExecution/requestApproval",
            Some(json!({ "decision": "decline" })),
            Verdict::Breach,
        ),
        (
            "execCommandApproval",
            Some(json!({ "decision": "denied" })),
            Verdict::Breach,
        ),
        (
            "mcpServer/elicitation/request",
            Some(json!({ "action": "decline" })),
            Verdict::Breach,
        ),
        ("item/permissions/requestApproval", None, Verdict::Breach),
        ("item/tool/requestUserInput", None, Verdict::Breach),
        ("item/tool/call", None, Verdict::Breach),
    ];
    for (method, refusal, verdict) in cases {
        let mut script = Script::new(vec![turn_started(), provider_request(method)]);
        script.after_interrupt = late_answer();
        let ran = run(script);
        assert_eq!(ran.end.outcome, failed(Failure::ToolRefused), "{method}");
        assert_eq!(ran.end.verdict, verdict, "{method}");
        let (at, answer) = answer_to_provider(&ran.seen).unwrap();
        assert!(
            position(&ran.seen, "turn/interrupt").unwrap() < at,
            "{method}"
        );
        match &refusal {
            Some(result) => assert_eq!(&answer["result"], result, "{method}"),
            None => {
                assert!(answer.get("error").is_some(), "{method}");
                assert!(answer.get("result").is_none(), "{method}");
            }
        }
    }
}

#[test]
fn a_patch_an_effect_or_another_model_stops_the_turn() {
    let cases = vec![
        (
            "file change",
            item("fileChange"),
            StopCause::PatchAttempt,
            failed(Failure::ToolRefused),
            Verdict::Clean,
        ),
        (
            "diff",
            notification("turn/diff/updated", json!({ "threadId": "thread-1" })),
            StopCause::PatchAttempt,
            failed(Failure::ToolRefused),
            Verdict::Clean,
        ),
        (
            "patch update",
            notification(
                "item/fileChange/patchUpdated",
                json!({ "threadId": "thread-1" }),
            ),
            StopCause::PatchAttempt,
            failed(Failure::ToolRefused),
            Verdict::Clean,
        ),
        (
            "command",
            item("commandExecution"),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "web search",
            item("webSearch"),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "MCP tool",
            item("mcpToolCall"),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "image view",
            item("imageView"),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "hook",
            notification("hook/started", json!({ "threadId": "thread-1" })),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "file system",
            notification("fs/changed", json!({})),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "another thread",
            notification(
                "thread/tokenUsage/updated",
                json!({ "threadId": "thread-2" }),
            ),
            StopCause::Breach,
            failed(Failure::ToolRefused),
            Verdict::Breach,
        ),
        (
            "another model",
            notification(
                "model/rerouted",
                json!({ "threadId": "thread-1", "turnId": "turn-1", "fromModel": MODEL, "toModel": "other", "reason": "x" }),
            ),
            StopCause::Rerouted,
            failed(Failure::ProviderFailed),
            Verdict::Clean,
        ),
    ];
    for (name, event, cause, outcome, verdict) in cases {
        let mut script = Script::new(vec![turn_started(), event]);
        script.after_interrupt = late_answer();
        let ran = run(script);
        assert_eq!(ran.end.outcome, outcome, "{name}");
        assert_eq!(ran.end.verdict, verdict, "{name}");
        let stop = ran.end.stop.unwrap();
        assert_eq!(stop.cause, cause, "{name}");
        assert!(
            stop.interrupt_sent && stop.interrupt_acknowledged && stop.turn_interrupted,
            "{name}"
        );
    }
}

#[test]
fn only_a_complete_successful_answer_is_read() {
    let limits = notification(
        "account/rateLimits/updated",
        json!({ "rateLimits": { "primary": { "usedPercent": 100.0, "windowDurationMins": 300, "resetsAt": 1_790_000_000 }, "secondary": null } }),
    );
    let usage = json!({ "message": "limit", "codexErrorInfo": "usageLimitExceeded", "additionalDetails": null });
    let unauthorized = json!({ "message": "signed out", "codexErrorInfo": "unauthorized", "additionalDetails": null });
    let cases: Vec<(&str, Vec<Value>, TurnOutcome)> = vec![
        (
            "not JSON",
            answered("Here is your extension!"),
            failed(Failure::InvalidOutput),
        ),
        (
            "no answer",
            vec![turn_started(), completed("completed", Value::Null)],
            failed(Failure::InvalidOutput),
        ),
        (
            "answer too large",
            vec![
                turn_started(),
                message(&"x".repeat(300 * 1024), "final_answer"),
                completed("completed", Value::Null),
            ],
            failed(Failure::OutputTooLarge),
        ),
        (
            "usage limit with its reset",
            vec![turn_started(), limits, completed("failed", usage.clone())],
            TurnOutcome::Failed {
                reason: Failure::UsageLimit,
                resets_at: Some("2026-09-21T14:13:20Z".to_string()),
            },
        ),
        (
            "usage limit without a reset",
            vec![turn_started(), completed("failed", usage)],
            failed(Failure::UsageLimit),
        ),
        (
            "signed out",
            vec![turn_started(), completed("failed", unauthorized)],
            failed(Failure::NotConnected),
        ),
        (
            "interrupted by the provider",
            vec![turn_started(), completed("interrupted", Value::Null)],
            failed(Failure::ProviderFailed),
        ),
        (
            "stream ends",
            vec![
                turn_started(),
                message(ANSWER, "final_answer"),
                json!(CLOSE),
            ],
            failed(Failure::ProviderFailed),
        ),
    ];
    for (name, events, expected) in cases {
        let ran = run(Script::new(events));
        assert_eq!(ran.end.outcome, expected, "{name}");
        assert_eq!(ran.end.verdict, Verdict::Clean, "{name}");
    }
    // Commentary is not the answer; the final message is.
    let ran = run(Script::new(vec![
        turn_started(),
        message(ANSWER, "final_answer"),
        message("Working on it", "commentary"),
        completed("completed", Value::Null),
    ]));
    assert_eq!(ran.end.outcome, candidate());
}

#[test]
fn a_line_past_its_bound_is_never_read() {
    let line =
        json!({ "method": "warning", "params": { "message": "x".repeat(MAX_LINE_BYTES + 16) } });
    let ran = run(Script::new(vec![turn_started(), line]));
    assert_eq!(ran.end.outcome, failed(Failure::ProviderFailed));
}

#[test]
fn cancelling_interrupts_the_accepted_turn_and_reports_it_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let payload = prompt::build(REQUEST, &[], &[], None);
    let mut served = app_server(Script::new(vec![turn_started()]));
    let (started, working) = mpsc::channel();
    let control = Arc::new(TurnControl::new(Box::new(move |phase| {
        if phase == TurnPhase::Working {
            let _ = started.send(());
        }
    })));
    let running = Arc::clone(&control);
    let folder = dir.path().to_path_buf();
    let turn = std::thread::spawn(move || {
        let expect = Expect {
            run_dir: &folder,
            model_provider: "openai",
        };
        let deadline = Instant::now() + Duration::from_secs(20);
        let end = session::run_turn(
            &mut served.connection,
            &payload,
            &expect,
            &admit_all,
            &running,
            deadline,
        );
        (end, served.finish())
    });
    working.recv_timeout(Duration::from_secs(10)).unwrap();
    control.cancel();
    let (end, seen) = turn.join().unwrap();
    assert_eq!(end.outcome, TurnOutcome::Stopped);
    let stop = end.stop.unwrap();
    assert_eq!(stop.cause, StopCause::Cancelled);
    assert!(stop.interrupt_sent && stop.interrupt_acknowledged && stop.turn_interrupted);
    let interrupt = position(&seen, "turn/interrupt").expect("an interrupt");
    assert_eq!(
        seen[interrupt]["params"],
        json!({ "threadId": "thread-1", "turnId": "turn-1" })
    );
}

// --- Bounded writes --------------------------------------------------------------------------

/// The largest payload a Send may carry: the request and attachments at their bounds.
fn largest_payload() -> Payload {
    let request = "r".repeat(REQUEST_BYTES);
    let mut left = PAYLOAD_BYTES - REQUEST_BYTES;
    let mut attachments = Vec::new();
    while left > 0 {
        let bytes = left.min(ATTACHMENT_BYTES);
        attachments.push(Attachment {
            kind: AttachmentKind::PastedText,
            label: format!("Attachment {}", attachments.len() + 1),
            text: "x".repeat(bytes),
        });
        left -= bytes;
    }
    prompt::build(&request, &attachments, &[], None)
}

/// A provider that stops reading cannot hold a send past its bound or past a cancel, later sends
/// fail at once, and the writing thread ends once the provider is gone.
#[test]
fn a_send_to_a_provider_that_stops_reading_ends_at_its_bound_or_on_cancel() {
    let payload = largest_payload();
    let params =
        json!({ "threadId": "thread-1", "input": [{ "type": "text", "text": payload.message }] });
    assert!(params.to_string().len() > PAYLOAD_BYTES);

    let (client_reads, _server_writes) = std::io::pipe().unwrap();
    let (server_reads, client_writes) = std::io::pipe().unwrap();
    let mut connection = Connection::new(client_reads, client_writes);
    let writer_done = connection.writer_done();
    let started = Instant::now();
    let deadline = Instant::now() + Duration::from_millis(500);
    assert!(connection
        .request_within("turn/start", params.clone(), deadline, &|| false)
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(3));
    let started = Instant::now();
    assert!(connection.request("turn/interrupt", json!({})).is_err());
    assert!(connection
        .refuse(&json!("provider-1"), "item/fileChange/requestApproval")
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(1));

    let (cancel_reads, _cancel_writes) = std::io::pipe().unwrap();
    let (cancel_server_reads, cancel_client_writes) = std::io::pipe().unwrap();
    let mut cancelled_connection = Connection::new(cancel_reads, cancel_client_writes);
    let cancelled_writer_done = cancelled_connection.writer_done();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let far = Instant::now() + Duration::from_secs(60);
    let sent = cancelled_connection.request_within("turn/start", params, far, &|| {
        cancelled.load(Ordering::SeqCst)
    });
    assert!(sent.is_err());
    assert!(started.elapsed() < Duration::from_secs(3));
    canceller.join().unwrap();

    // The provider is gone, as once it is killed: each blocked write fails and its thread ends.
    drop(server_reads);
    drop(cancel_server_reads);
    drop(connection);
    drop(cancelled_connection);
    let until = Instant::now() + Duration::from_secs(5);
    let ended =
        || writer_done.load(Ordering::SeqCst) && cancelled_writer_done.load(Ordering::SeqCst);
    while !ended() {
        assert!(Instant::now() < until, "a writing thread did not end");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The same through a turn: a provider that stops reading during the person's text ends the turn
/// at its deadline, or at once on cancel, so the caller always reaches the kill.
#[test]
fn a_turn_whose_provider_stops_reading_ends_at_its_deadline_or_on_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let payload = largest_payload();
    let expect = Expect {
        run_dir: dir.path(),
        model_provider: "openai",
    };

    let mut script = Script::new(answered(ANSWER));
    script.stall_after_thread = true;
    let mut served = app_server(script);
    let (control, _) = recording_control();
    let started = Instant::now();
    let deadline = Instant::now() + Duration::from_secs(2);
    let end = session::run_turn(
        &mut served.connection,
        &payload,
        &expect,
        &admit_all,
        &control,
        deadline,
    );
    assert_eq!(end.outcome, failed(Failure::ProviderFailed));
    assert!(started.elapsed() < Duration::from_secs(5));
    served.finish();

    let mut script = Script::new(answered(ANSWER));
    script.stall_after_thread = true;
    let mut served = app_server(script);
    let (control, _) = recording_control();
    let cancelling = Arc::clone(&control);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        cancelling.cancel();
    });
    let started = Instant::now();
    let deadline = Instant::now() + Duration::from_secs(60);
    let end = session::run_turn(
        &mut served.connection,
        &payload,
        &expect,
        &admit_all,
        &control,
        deadline,
    );
    assert_eq!(end.outcome, TurnOutcome::Stopped);
    assert!(started.elapsed() < Duration::from_secs(5));
    canceller.join().unwrap();
    served.finish();
}

/// A send already cancelled, or already past its deadline, is refused before anything is handed
/// to the writer: no frame reaches the provider, and the connection still writes the next one.
#[test]
fn a_send_already_cancelled_or_past_its_deadline_writes_no_frame() {
    let (client_reads, _server_writes) = std::io::pipe().unwrap();
    let (server_reads, client_writes) = std::io::pipe().unwrap();
    let mut connection = Connection::new(client_reads, client_writes);
    let params = json!({ "threadId": "thread-1", "input": [] });
    let later = Instant::now() + Duration::from_secs(10);
    let cancelled = connection.request_within("turn/start", params.clone(), later, &|| true);
    assert!(cancelled.is_err());
    let expired = Instant::now();
    let late = connection.request_within("turn/start", params, expired, &|| false);
    assert!(late.is_err());
    assert!(connection.request("initialize", json!({})).is_ok());
    drop(connection);
    let frames: Vec<Value> = BufReader::new(server_reads)
        .lines()
        .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
        .collect();
    assert_eq!(frames.len(), 1);
    assert_eq!(method_of(&frames[0]), Some("initialize"));
}

/// A cancel that has arrived before the thread starts keeps both the thread and the turn from
/// being sent at all.
#[test]
fn a_cancel_before_the_thread_starts_sends_neither_thread_nor_turn() {
    let dir = tempfile::tempdir().unwrap();
    let payload = prompt::build(REQUEST, &[], &[], None);
    let mut served = app_server(Script::new(answered(ANSWER)));
    let (control, _) = recording_control();
    let cancelling = Arc::clone(&control);
    // The gate is the last step before the thread starts.
    let admit = move |_: &Reported| {
        cancelling.cancel();
        Vec::new()
    };
    let expect = Expect {
        run_dir: dir.path(),
        model_provider: "openai",
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    let end = session::run_turn(
        &mut served.connection,
        &payload,
        &expect,
        &admit,
        &control,
        deadline,
    );
    let seen = served.finish();
    assert_eq!(end.outcome, TurnOutcome::Stopped);
    assert_eq!(position(&seen, "thread/start"), None);
    assert_eq!(position(&seen, "turn/start"), None);
    assert!(!sent_text(&seen).contains(REQUEST));
}

/// The account read after a sign-in stops as soon as the sign-in is cancelled.
#[test]
fn an_account_read_stops_on_cancel() {
    let mut served = serve(|request, replies| {
        if method_of(request) == Some("initialize") {
            replies.push(json!({ "id": request["id"], "result": {} }));
        }
    });
    session::initialize(
        &mut served.connection,
        Instant::now() + Duration::from_secs(5),
        &|| false,
    )
    .unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let far = Instant::now() + Duration::from_secs(30);
    let read = session::read_account(&mut served.connection, far, &|| {
        cancelled.load(Ordering::SeqCst)
    });
    assert_eq!(read, Err(Halt::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(2));
    canceller.join().unwrap();
    served.finish();
}

// --- The provider's own state ----------------------------------------------------------------

fn end_with(outcome: TurnOutcome) -> TurnEnd {
    TurnEnd {
        outcome,
        verdict: Verdict::Clean,
        stop: None,
    }
}

/// Without proof that its process group is gone, a turn is `Unconfirmed` whatever it ended with,
/// and Codex starts nothing more until the app restarts. It still signs out locally, but the
/// sign-out answers `stopping`: that group is still unproven.
#[test]
fn an_unproven_end_is_unconfirmed_whatever_the_turn_ended_with() {
    for outcome in [
        candidate(),
        failed(Failure::ToolRefused),
        TurnOutcome::Stopped,
        failed(Failure::NotConnected),
    ] {
        let stand = stand_in();
        let codex = pinned_codex(&stand);
        codex.assume_connected();
        let provider = CodexProvider(Arc::clone(&codex));
        assert_eq!(
            codex.settle_for_test(end_with(outcome.clone()), true),
            outcome
        );
        assert_eq!(
            provider.snapshot().state,
            if outcome == failed(Failure::NotConnected) {
                ProviderState::SignedOut { last_connect: None }
            } else {
                ProviderState::Connected
            }
        );
        assert_eq!(
            codex.settle_for_test(end_with(outcome.clone()), false),
            TurnOutcome::Unconfirmed,
            "{outcome:?}"
        );
        assert_eq!(
            provider.snapshot().state,
            ProviderState::Unavailable {
                reason: UnavailableReason::Unqualified,
                installed_version: Some(PINNED_VERSION.to_string())
            }
        );
        let (control, _) = recording_control();
        let payload = prompt::build(REQUEST, &[], &[], None);
        assert_eq!(
            provider.run_turn(&payload, &control),
            failed(Failure::ProviderFailed)
        );

        let layout = Layout::prepare(&stand.root).unwrap();
        fs::write(layout.auth_file(), "{}").unwrap();
        assert_eq!(provider.disconnect(), DisconnectReply::Stopping);
        assert!(!layout.auth_file().exists());
        assert_eq!(provider.disconnect(), DisconnectReply::Stopping);
        assert_eq!(codex.spawns(), 0);
    }
}

/// A turn the provider refused for its sign-in signs Codex out without starting a new account
/// epoch, so that turn keeps `notConnected`; a later sign-in starts one.
#[test]
fn a_refused_sign_in_signs_out_without_changing_the_account_epoch() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    codex.assume_connected();
    let epoch = provider.snapshot().account_epoch;
    assert_eq!(
        codex.settle_for_test(end_with(failed(Failure::NotConnected)), true),
        failed(Failure::NotConnected)
    );
    let after = provider.snapshot();
    assert_eq!(after.state, ProviderState::SignedOut { last_connect: None });
    assert_eq!(after.account_epoch, epoch);
    codex.assume_connected();
    assert_ne!(provider.snapshot().account_epoch, epoch);
}

/// A cancel during the account read that follows a successful sign-in wins: the late result is
/// never published as connected, and what the sign-in stored is removed.
#[test]
fn a_cancelled_sign_in_never_connects_however_late_its_account_read_ends() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let layout = Layout::prepare(&stand.root).unwrap();
    fs::write(layout.auth_file(), "{}").unwrap();
    let pending = codex.begin_sign_in_for_test();
    assert_eq!(provider.snapshot().state, ProviderState::Connecting);
    let (go, wait) = mpsc::channel::<()>();
    let late = {
        let codex = Arc::clone(&codex);
        std::thread::spawn(move || {
            wait.recv().unwrap();
            // The account read is still under way when the cancel comes.
            std::thread::sleep(Duration::from_millis(300));
            codex.finish_sign_in_for_test(&pending, true, true);
        })
    };
    go.send(()).unwrap();
    let started = Instant::now();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Cancelled);
    assert!(
        started.elapsed() >= Duration::from_millis(200),
        "cancel answered before the sign-in ended"
    );
    late.join().unwrap();
    assert_eq!(
        provider.snapshot().state,
        ProviderState::SignedOut {
            last_connect: Some(LastConnect::Cancelled)
        }
    );
    assert!(!layout.auth_file().exists());

    // Finished before the cancel: connected, and there is nothing left to cancel.
    fs::write(layout.auth_file(), "{}").unwrap();
    let pending = codex.begin_sign_in_for_test();
    codex.finish_sign_in_for_test(&pending, true, true);
    assert_eq!(provider.snapshot().state, ProviderState::Connected);
    assert_eq!(provider.cancel_connect(), CancelConnectReply::NotConnecting);
    assert!(layout.auth_file().exists());
    assert_eq!(codex.spawns(), 0);
}

/// A sign-in that is no longer the current one changes nothing when it ends.
#[test]
fn a_superseded_sign_in_changes_nothing() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let first = codex.begin_sign_in_for_test();
    codex.finish_sign_in_for_test(&first, true, false);
    assert_eq!(
        provider.snapshot().state,
        ProviderState::SignedOut {
            last_connect: Some(LastConnect::Failed)
        }
    );
    let _second = codex.begin_sign_in_for_test();
    codex.finish_sign_in_for_test(&first, true, true);
    assert_eq!(provider.snapshot().state, ProviderState::Connecting);
}

/// A sign-out while a sign-in is still ending signs out at once and answers `stopping`; the
/// sign-in, ending later, cannot connect.
#[test]
fn a_sign_out_during_a_sign_in_that_has_not_ended_answers_stopping() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let layout = Layout::prepare(&stand.root).unwrap();
    let pending = codex.begin_sign_in_for_test();
    fs::write(layout.auth_file(), "{}").unwrap();
    assert_eq!(provider.disconnect(), DisconnectReply::Stopping);
    assert!(!layout.auth_file().exists());
    codex.finish_sign_in_for_test(&pending, true, true);
    assert_eq!(
        provider.snapshot().state,
        ProviderState::SignedOut {
            last_connect: Some(LastConnect::Cancelled)
        }
    );
    // It has ended with its cleanup proven: nothing is left unresolved.
    assert_eq!(provider.cancel_connect(), CancelConnectReply::NotConnecting);
}

/// A cancelled sign-in whose credential cannot be removed is blocked: the cancel is not reported
/// as done, the credential is never read or used, not even after a restart, and nothing connects
/// or sends, until removal succeeds. Removal is made to fail by putting a folder where the
/// credential file is.
#[test]
fn a_cancelled_credential_that_cannot_be_removed_stays_blocked() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let layout = Layout::prepare(&stand.root).unwrap();
    fs::create_dir_all(layout.auth_file().join("undeletable")).unwrap();
    let pending = codex.begin_sign_in_for_test();
    let (go, wait) = mpsc::channel::<()>();
    let late = {
        let codex = Arc::clone(&codex);
        std::thread::spawn(move || {
            wait.recv().unwrap();
            std::thread::sleep(Duration::from_millis(300));
            codex.finish_sign_in_for_test(&pending, true, true);
        })
    };
    go.send(()).unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    late.join().unwrap();

    let blocked = ProviderState::Unavailable {
        reason: UnavailableReason::Failed,
        installed_version: Some(PINNED_VERSION.to_string()),
    };
    assert_eq!(provider.snapshot().state, blocked);
    assert_eq!(provider.snapshot().state, blocked);
    let (control, _) = recording_control();
    let payload = prompt::build(REQUEST, &[], &[], None);
    assert_eq!(
        provider.run_turn(&payload, &control),
        failed(Failure::NotConnected)
    );
    assert_eq!(
        provider.connect(&|_: &str| true),
        ConnectReply::Refused {
            reason: ConnectRefusal::Unavailable
        }
    );
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    assert_eq!(
        provider.disconnect(),
        DisconnectReply::Refused {
            reason: DisconnectRefusal::Failed
        }
    );
    assert!(stand.root.join("cancelled-sign-in").exists());

    // After a restart the credential is still blocked, not read.
    let restarted = pinned_codex(&stand);
    let restarted_provider = CodexProvider(Arc::clone(&restarted));
    assert_eq!(restarted_provider.snapshot().state, blocked);
    assert_eq!(
        restarted_provider.cancel_connect(),
        CancelConnectReply::Unconfirmed
    );

    // Once removal works, the cancellation is resolved, and only then reported done.
    fs::remove_dir_all(layout.auth_file()).unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Cancelled);
    assert_eq!(
        provider.snapshot().state,
        ProviderState::SignedOut {
            last_connect: Some(LastConnect::Cancelled)
        }
    );
    assert!(!stand.root.join("cancelled-sign-in").exists());
    assert_eq!(provider.cancel_connect(), CancelConnectReply::NotConnecting);
    assert_eq!(codex.spawns(), 0);
    assert_eq!(restarted.spawns(), 0);
}

/// The cancellation is resolved only once both the credential and its marker are gone. Here the
/// credential is removed but the marker cannot be (a folder stands where the marker file is):
/// the cancel is not reported done, no new sign-in starts, a restart stays blocked, and only
/// once the marker goes does the cancellation resolve.
#[test]
fn a_cancellation_whose_marker_cannot_be_removed_stays_unresolved() {
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let layout = Layout::prepare(&stand.root).unwrap();
    let marker = stand.root.join("cancelled-sign-in");
    fs::create_dir_all(marker.join("undeletable")).unwrap();
    fs::write(layout.auth_file(), "{}").unwrap();
    let pending = codex.begin_sign_in_for_test();
    let (go, wait) = mpsc::channel::<()>();
    let late = {
        let codex = Arc::clone(&codex);
        std::thread::spawn(move || {
            wait.recv().unwrap();
            std::thread::sleep(Duration::from_millis(300));
            codex.finish_sign_in_for_test(&pending, true, true);
        })
    };
    go.send(()).unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    late.join().unwrap();
    assert!(!layout.auth_file().exists());
    assert!(marker.exists());

    let blocked = ProviderState::Unavailable {
        reason: UnavailableReason::Failed,
        installed_version: Some(PINNED_VERSION.to_string()),
    };
    assert_eq!(provider.snapshot().state, blocked);
    assert_eq!(
        provider.connect(&|_: &str| true),
        ConnectReply::Refused {
            reason: ConnectRefusal::Unavailable
        }
    );
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    let restarted = CodexProvider(pinned_codex(&stand));
    assert_eq!(restarted.snapshot().state, blocked);

    fs::remove_dir_all(marker).unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Cancelled);
    assert_eq!(
        provider.snapshot().state,
        ProviderState::SignedOut {
            last_connect: Some(LastConnect::Cancelled)
        }
    );
    assert_eq!(provider.cancel_connect(), CancelConnectReply::NotConnecting);
    assert_eq!(codex.spawns(), 0);
}

/// A sign-in process whose group cannot be proven gone: no account is read after it, what it
/// stored is discarded, and neither a cancel nor a sign-out reports its cleanup as complete,
/// even after its worker has ended.
#[test]
fn an_unproven_sign_in_cleanup_is_never_reported_complete() {
    // Cancelled while its cleanup is unproven.
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let pending = codex.begin_sign_in_for_test();
    let (go, wait) = mpsc::channel::<()>();
    let late = {
        let codex = Arc::clone(&codex);
        std::thread::spawn(move || {
            wait.recv().unwrap();
            std::thread::sleep(Duration::from_millis(300));
            codex.finish_sign_in_for_test(&pending, false, true);
        })
    };
    go.send(()).unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    late.join().unwrap();
    assert_eq!(provider.cancel_connect(), CancelConnectReply::Unconfirmed);
    assert_eq!(provider.disconnect(), DisconnectReply::Stopping);
    assert_eq!(provider.disconnect(), DisconnectReply::Stopping);

    // Not cancelled: its worker ends, the credential the login stored is discarded unread, and a
    // later sign-out still answers `stopping`.
    let stand = stand_in();
    let codex = pinned_codex(&stand);
    let provider = CodexProvider(Arc::clone(&codex));
    let layout = Layout::prepare(&stand.root).unwrap();
    let pending = codex.begin_sign_in_for_test();
    fs::write(layout.auth_file(), "{}").unwrap();
    codex.finish_sign_in_for_test(&pending, false, true);
    assert!(!layout.auth_file().exists());
    assert_eq!(
        provider.snapshot().state,
        ProviderState::Unavailable {
            reason: UnavailableReason::Unqualified,
            installed_version: Some(PINNED_VERSION.to_string())
        }
    );
    assert_ne!(provider.cancel_connect(), CancelConnectReply::Cancelled);
    assert_eq!(provider.disconnect(), DisconnectReply::Stopping);
    assert_eq!(codex.spawns(), 0);
}

// --- The offline qualification of the pinned build -------------------------------------------

const QUALIFICATION_BINARY: &str = "LEADINGLIGHT_CODEX_QUALIFICATION_BINARY";
const QUALIFICATION_EVIDENCE: &str = "LEADINGLIGHT_CODEX_QUALIFICATION_EVIDENCE";
const BENIGN: &str = "LLQ-BENIGN";
const FOREIGN: &str = "LLQ-FOREIGN";
const ADD: &str = "LLQ-ADD";
const QUESTION: &str = "LLQ-QUESTION";
const CANCEL: &str = "LLQ-CANCEL";
const MISMATCH: &str = "LLQ-MISMATCH";
const REFUSED_CONTAMINATED: &str = "LLQ-CONTAMINATED";

/// A synthetic note outside the working folder: an anchor a patch may quote, and a sentinel next
/// to it that nothing ever sends.
struct Canary {
    path: PathBuf,
    anchor: String,
    sentinel: String,
}

#[derive(Debug, PartialEq, Eq)]
struct FileState {
    sha256: String,
    bytes: u64,
    modified: (i64, i64),
    inode: u64,
}

fn file_state(path: &Path) -> Option<FileState> {
    let meta = fs::symlink_metadata(path).ok()?;
    Some(FileState {
        sha256: process::sha256_file(path)?,
        bytes: meta.len(),
        modified: (meta.mtime(), meta.mtime_nsec()),
        inode: meta.ino(),
    })
}

fn token(kind: &str) -> String {
    format!("{kind}-{}", uuid::Uuid::new_v4().simple())
}

/// Answers by which scenario's marker the request carries. Each scenario's injection is sent once;
/// later requests of the same turn carry the same marker and get its follow-up answer.
fn qualification_plan(patches: BTreeMap<&'static str, String>) -> Box<loopback::Plan> {
    let injected: Mutex<BTreeSet<&'static str>> = Mutex::new(BTreeSet::new());
    let count = AtomicUsize::new(0);
    let benign = quick_note_answer();
    Box::new(move |_body: &Value, text: &str| {
        let id = format!("resp_{}", count.fetch_add(1, Ordering::SeqCst));
        let first = |marker: &'static str| injected.lock().unwrap().insert(marker);
        let question = json!({ "questions": [{
            "id": "recipe_choice", "header": "Recipe", "question": "Which recipe should change?",
            "options": [
                { "label": "Debrief (Recommended)", "description": "Edit the meeting debrief recipe." },
                { "label": "Quick note", "description": "Edit the quick note recipe." }
            ]
        }] });
        let label = |name: &str| name.to_string();
        if text.contains(BENIGN) {
            (
                label("benignReply"),
                Answer::Events(loopback::message(&id, &benign)),
            )
        } else if text.contains(FOREIGN) && first(FOREIGN) {
            let calls = ["update", "delete", "move"]
                .iter()
                .map(|key| {
                    loopback::custom_call(&format!("call_{key}"), "apply_patch", &patches[key])
                })
                .collect();
            (
                label("foreignPatches"),
                Answer::Events(loopback::calls(&id, calls)),
            )
        } else if text.contains(FOREIGN) {
            (
                label("foreignFollowUp"),
                Answer::Events(loopback::message(&id, UNSUPPORTED)),
            )
        } else if text.contains(ADD) && first(ADD) {
            let calls = vec![loopback::custom_call(
                "call_add",
                "apply_patch",
                &patches["add"],
            )];
            (
                label("addPatch"),
                Answer::Events(loopback::calls(&id, calls)),
            )
        } else if text.contains(ADD) {
            (
                label("addFollowUp"),
                Answer::Events(loopback::message(&id, ANSWER)),
            )
        } else if text.contains(QUESTION) && first(QUESTION) {
            let calls = vec![loopback::function_call(
                "call_question",
                "request_user_input",
                &question,
            )];
            (
                label("question"),
                Answer::Events(loopback::calls(&id, calls)),
            )
        } else if text.contains(QUESTION) {
            (
                label("questionFollowUp"),
                Answer::Events(loopback::message(&id, ANSWER)),
            )
        } else if text.contains(CANCEL) {
            (
                label("held"),
                Answer::Hold(vec![loopback::created(&id)], Duration::from_secs(60)),
            )
        } else {
            (
                label("unexpected"),
                Answer::Events(loopback::message(&id, ANSWER)),
            )
        }
    })
}

fn qualification_settings(
    binary: &Path,
    user: &Path,
    loopback: &Loopback,
    model: &str,
) -> Settings {
    let proxy = loopback.proxy();
    let mut extra_env = vec![(
        loopback::TOKEN_ENV.to_string(),
        loopback::DUMMY_TOKEN.into(),
    )];
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        extra_env.push((key.to_string(), proxy.clone().into()));
    }
    for key in ["NO_PROXY", "no_proxy"] {
        extra_env.push((key.to_string(), "127.0.0.1,localhost".into()));
    }
    Settings {
        candidates: vec![binary.to_path_buf()],
        pin: Pin::qualified(),
        boundary: Some(user.to_path_buf()),
        managed: guard::MANAGED_CONFIG.iter().map(PathBuf::from).collect(),
        model: model.to_string(),
        provider: Some(ModelProvider {
            id: "llfake".to_string(),
            base_url: loopback.base_url(),
            env_key: loopback::TOKEN_ENV.to_string(),
        }),
        extra_env,
    }
}

struct TurnRun {
    outcome: TurnOutcome,
    payload: Payload,
    phases: Vec<TurnPhase>,
    elapsed: Duration,
}

fn qualified_turn(provider: &CodexProvider, request: &str) -> TurnRun {
    let payload = prompt::build(request, &[], &[], None);
    let (control, phases) = recording_control();
    let started = Instant::now();
    let outcome = provider.run_turn(&payload, &control);
    let phases = phases.lock().unwrap().clone();
    TurnRun {
        outcome,
        payload,
        phases,
        elapsed: started.elapsed(),
    }
}

fn texts_of(body: &Value) -> Vec<(String, String, String)> {
    body.get("input")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| {
            let field = |name: &str| {
                item.get(name)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            (field("type"), field("role"), loopback::item_text(item))
        })
        .collect()
}

fn group_of<'a>(received: &'a [loopback::Received], marker: &str) -> Vec<&'a loopback::Received> {
    received
        .iter()
        .filter(|request| request.answer != "notServed" && request.text.contains(marker))
        .collect()
}

/// The pinned Codex binary through this exact adapter, against a loopback fixture: a benign
/// structured reply; foreign Update, Delete and Move reads denied; an Add stopped, declined only
/// after the interrupt, killed and reaped with no continuation; a Default-mode question inert;
/// cancel; and contamination and mismatches refused. No credential, sign-in or network.
#[test]
#[ignore = "runs the pinned Codex binary; set LEADINGLIGHT_CODEX_QUALIFICATION_BINARY (see docs/leadinglight/adapt-provider.md)"]
fn qualification_pinned_codex_through_the_production_adapter() {
    let binary = PathBuf::from(
        std::env::var_os(QUALIFICATION_BINARY)
            .unwrap_or_else(|| panic!("{QUALIFICATION_BINARY} must name the pinned Codex binary")),
    );
    assert!(
        matches!(
            process::discover(std::slice::from_ref(&binary), &Pin::qualified()),
            Discovery::Pinned(_)
        ),
        "{} is not the pinned build",
        binary.display()
    );
    let binary = binary.canonicalize().unwrap();

    // A synthetic person: their home, with instruction and configuration canaries the runtime
    // must never consult, notes outside the working folder, and LeadingLight's app data.
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("user");
    fs::create_dir_all(&user).unwrap();
    let user = user.canonicalize().unwrap();
    let ancestor_tokens: Vec<String> = (0..4).map(|_| token("LLQ-ANCESTOR")).collect();
    write(&user.join("AGENTS.md"), &ancestor_tokens[0]);
    write(
        &user.join(".codex/config.toml"),
        &format!("developer_instructions = \"{}\"\n", ancestor_tokens[1]),
    );
    write(&user.join(".codex/AGENTS.md"), &ancestor_tokens[2]);
    write(
        &user.join(".agents/skills/ll-foreign/SKILL.md"),
        &format!(
            "---\nname: ll-foreign\ndescription: {}\n---\n",
            ancestor_tokens[3]
        ),
    );
    let notes = user.join("Notes/foreign-notes");
    fs::create_dir_all(&notes).unwrap();
    let mut canaries = BTreeMap::new();
    for (key, name) in [
        ("update", "update-target.md"),
        ("delete", "delete-target.md"),
        ("move", "move-source.md"),
    ] {
        let canary = Canary {
            path: notes.join(name),
            anchor: token("LLQ-ANCHOR"),
            sentinel: token("LLQ-SENTINEL"),
        };
        fs::write(
            &canary.path,
            format!(
                "# Synthetic {key} note\n{}\n{}\nTrailing line\n",
                canary.anchor, canary.sentinel
            ),
        )
        .unwrap();
        canaries.insert(key, canary);
    }
    let added = notes.join("added-by-model.md");
    let moved = notes.join("moved-by-model.md");
    let patches = BTreeMap::from([
        (
            "update",
            format!("*** Begin Patch\n*** Update File: {}\n@@\n {}\n+LLQ-UPDATE-PAYLOAD\n*** End Patch\n", canaries["update"].path.display(), canaries["update"].anchor),
        ),
        ("delete", format!("*** Begin Patch\n*** Delete File: {}\n*** End Patch\n", canaries["delete"].path.display())),
        (
            "move",
            format!(
                "*** Begin Patch\n*** Update File: {}\n*** Move to: {}\n@@\n {}\n+LLQ-MOVE-PAYLOAD\n*** End Patch\n",
                canaries["move"].path.display(),
                moved.display(),
                canaries["move"].anchor
            ),
        ),
        ("add", format!("*** Begin Patch\n*** Add File: {}\n+LLQ-ADD-PAYLOAD\n*** End Patch\n", added.display())),
    ]);
    let before: BTreeMap<&str, Option<FileState>> = canaries
        .iter()
        .map(|(key, canary)| (*key, file_state(&canary.path)))
        .collect();

    let loopback = Loopback::start(qualification_plan(patches)).unwrap();
    let app = user.join("Library/Application Support/LeadingLight");
    let root = app.join("adapt/provider/codex");
    let codex = Arc::new(Codex::with(
        root.clone(),
        qualification_settings(&binary, &user, &loopback, MODEL),
    ));
    codex.assume_connected();
    let provider = CodexProvider(Arc::clone(&codex));
    assert_eq!(provider.snapshot().state, ProviderState::Connected);
    let layout = Layout::prepare(&root).unwrap();

    let mut checks: BTreeMap<String, bool> = BTreeMap::new();
    let mut check = |name: &str, passed: bool| {
        checks.insert(name.to_string(), passed);
    };
    let mut evidence = serde_json::Map::new();
    let tools_allowed =
        BTreeSet::from(["request_user_input".to_string(), "apply_patch".to_string()]);

    // 1. A benign structured reply, with only the explicit prompt and context sent.
    let benign = qualified_turn(
        &provider,
        &format!("{BENIGN}: Draft a meeting debrief extension."),
    );
    let received = loopback.received();
    let requests = group_of(&received, BENIGN);
    // The canned candidate came through the real runtime and this adapter unchanged, and the
    // native E1 admission accepts what was delivered.
    check("benign.reply", benign.outcome == quick_note_candidate());
    let delivered = match &benign.outcome {
        TurnOutcome::Reply(Reply::Candidate { package_text, .. }) => package_text.as_str(),
        _ => "",
    };
    check(
        "benign.packageAdmittedByE1",
        admitted_package_id(delivered).as_deref() == Some("local.quick-note"),
    );
    check(
        "benign.phases",
        benign.phases == [TurnPhase::Working, TurnPhase::Checking],
    );
    check("benign.oneRequest", requests.len() == 1);
    if let Some(request) = requests.first() {
        let body = &request.body;
        let texts = texts_of(body);
        let instructions_sent = body.get("instructions").and_then(Value::as_str)
            == Some(benign.payload.instructions.as_str())
            || texts
                .iter()
                .any(|(_, _, text)| *text == benign.payload.instructions);
        let only_explicit = texts.iter().all(|(kind, _, text)| {
            kind == "message"
                && (*text == benign.payload.message || *text == benign.payload.instructions)
        });
        let message_sent = texts
            .iter()
            .any(|(_, role, text)| role == "user" && *text == benign.payload.message);
        check(
            "benign.model",
            body.get("model").and_then(Value::as_str) == Some(MODEL),
        );
        let instructions = body.get("instructions").and_then(Value::as_str);
        check(
            "benign.noOtherInstructions",
            instructions.is_none_or(|text| text.is_empty() || text == benign.payload.instructions),
        );
        check(
            "benign.onlyInstructionsAndRequest",
            instructions_sent && message_sent && only_explicit,
        );
        check(
            "benign.outputSchemaForwarded",
            body.pointer("/text/format/type").and_then(Value::as_str) == Some("json_schema"),
        );
        evidence.insert(
            "benignInputItems".into(),
            json!(texts
                .iter()
                .map(|(kind, role, _)| format!("{kind}/{role}"))
                .collect::<Vec<_>>()),
        );
    }
    check(
        "benign.noStop",
        codex.last_stop().is_none() && codex.last_group_gone() == Some(true),
    );

    // 2. Foreign Update, Delete and Move: each read denied before any content, diff or approval.
    let foreign = qualified_turn(&provider, &format!("{FOREIGN}: Tidy my notes."));
    let received = loopback.received();
    let requests = group_of(&received, FOREIGN);
    let labels: Vec<&str> = requests
        .iter()
        .map(|request| request.answer.as_str())
        .collect();
    check(
        "foreign.injected",
        labels.first() == Some(&"foreignPatches"),
    );
    let outputs: BTreeMap<String, String> = requests
        .iter()
        .flat_map(|request| loopback::outputs(&request.body))
        .collect();
    for key in ["update", "delete", "move"] {
        let output = outputs
            .get(&format!("call_{key}"))
            .cloned()
            .unwrap_or_default();
        check(
            &format!("foreign.{key}.readDenied"),
            output.contains("Operation not permitted"),
        );
    }
    check("foreign.noApprovalOrPatchSeen", codex.last_stop().is_none());
    check("foreign.groupGone", codex.last_group_gone() == Some(true));
    check(
        "foreign.followUpReply",
        foreign.outcome
            == TurnOutcome::Reply(Reply::Unsupported {
                message: "Packages cannot change other files.".to_string(),
                alternative: None,
            }),
    );
    evidence.insert("foreignOutputs".into(), json!(outputs));

    // 3. Add: stopped at the patch, declined only after its own turn is confirmed interrupted,
    //    killed and reaped; nothing written, no candidate, no further request.
    let add = qualified_turn(&provider, &format!("{ADD}: Add a note."));
    std::thread::sleep(Duration::from_secs(2));
    let received = loopback.received();
    let requests = group_of(&received, ADD);
    let stop = codex.last_stop();
    check(
        "add.toolRefused",
        add.outcome == failed(Failure::ToolRefused),
    );
    check(
        "add.injected",
        requests.first().map(|request| request.answer.as_str()) == Some("addPatch"),
    );
    check("add.noContinuation", requests.len() == 1);
    check("add.nothingWritten", !added.exists());
    if let Some(stop) = &stop {
        let patch_requests = |methods: &[String]| {
            methods
                .iter()
                .all(|method| controls::PATCH_REQUESTS.contains(&method.as_str()))
        };
        check("add.stoppedAtPatch", stop.cause == StopCause::PatchAttempt);
        check(
            "add.interruptWithAcceptedIds",
            stop.interrupt_sent && stop.thread_id.is_some() && stop.turn_id.is_some(),
        );
        check("add.interruptAcknowledged", stop.interrupt_acknowledged);
        check("add.turnInterrupted", stop.turn_interrupted);
        check(
            "add.onlyPatchRequests",
            patch_requests(stop.refused.as_slice()) && patch_requests(stop.unanswered.as_slice()),
        );
        check("add.groupGone", stop.group_gone);
        evidence.insert("addStop".into(), json!(stop.summary()));
    } else {
        check("add.stopped", false);
    }

    // 4. A valid Default-mode question stays inert: the runtime refuses it itself.
    let question = qualified_turn(&provider, &format!("{QUESTION}: Which recipe?"));
    let received = loopback.received();
    let requests = group_of(&received, QUESTION);
    let outputs: BTreeMap<String, String> = requests
        .iter()
        .flat_map(|request| loopback::outputs(&request.body))
        .collect();
    check(
        "question.injected",
        requests.first().map(|request| request.answer.as_str()) == Some("question"),
    );
    check(
        "question.refusedInDefaultMode",
        outputs
            .get("call_question")
            .is_some_and(|output| output.contains("Default mode")),
    );
    check("question.noRequestToHost", codex.last_stop().is_none());
    check("question.groupGone", codex.last_group_gone() == Some(true));
    check("question.stillUsable", question.outcome == candidate());

    // 5. Cancel mid-response: interrupted by its ids, killed and reaped, stopped.
    let cancel_control = Arc::new(TurnControl::new(Box::new(|_: TurnPhase| {})));
    let cancelling = {
        let provider = CodexProvider(Arc::clone(&codex));
        let control = Arc::clone(&cancel_control);
        std::thread::spawn(move || {
            let payload = prompt::build(
                &format!("{CANCEL}: Draft a long extension."),
                &[],
                &[],
                None,
            );
            provider.run_turn(&payload, &control)
        })
    };
    let until = Instant::now() + Duration::from_secs(60);
    while group_of(&loopback.received(), CANCEL).is_empty() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(50));
    }
    let cancelled_at = Instant::now();
    cancel_control.cancel();
    let cancelled = cancelling.join().unwrap();
    loopback.release();
    let stop = codex.last_stop();
    check(
        "cancel.reachedProvider",
        !group_of(&loopback.received(), CANCEL).is_empty(),
    );
    check("cancel.stopped", cancelled == TurnOutcome::Stopped);
    check(
        "cancel.prompt",
        cancelled_at.elapsed() < Duration::from_secs(10),
    );
    check(
        "cancel.interruptAcknowledgedAndGroupGone",
        stop.as_ref().is_some_and(|stop| {
            stop.cause == StopCause::Cancelled
                && stop.interrupt_acknowledged
                && stop.turn_interrupted
                && stop.group_gone
        }),
    );

    // 6. Contamination of the working folder, its ancestry below the person's home, the private
    //    home and the helper links: refused before anything starts; admitted again once removed.
    let helpers = layout.codex_home().join("tmp/arg0/codex-arg0Zz99Yy");
    let contaminations: Vec<(&str, PathBuf)> = vec![
        ("workingFolder", layout.run().join("AGENTS.md")),
        ("ancestry", app.join("AGENTS.md")),
        ("privateHome", layout.codex_home().join("AGENTS.md")),
        ("helperLink", helpers.join("apply_patch")),
    ];
    for (name, path) in contaminations {
        if name == "helperLink" {
            fs::create_dir_all(&helpers).unwrap();
            fs::write(helpers.join(".lock"), b"").unwrap();
            std::os::unix::fs::symlink("/bin/sh", &path).unwrap();
        } else {
            write(&path, "LLQ-CANARY");
        }
        let spawns = codex.spawns();
        let requests = loopback.received().len();
        let refused = qualified_turn(&provider, &format!("{REFUSED_CONTAMINATED}: {name}"));
        let state = provider.snapshot().state;
        check(
            &format!("contamination.{name}.refused"),
            refused.outcome == failed(Failure::ProviderFailed),
        );
        check(
            &format!("contamination.{name}.nothingStarted"),
            codex.spawns() == spawns && loopback.received().len() == requests,
        );
        check(
            &format!("contamination.{name}.unqualified"),
            state
                == ProviderState::Unavailable {
                    reason: UnavailableReason::Unqualified,
                    installed_version: Some(PINNED_VERSION.to_string()),
                },
        );
        if name == "helperLink" {
            fs::remove_dir_all(&helpers).unwrap();
        } else {
            fs::remove_file(path).unwrap();
        }
        check(
            &format!("contamination.{name}.admittedOnceRemoved"),
            provider.snapshot().state == ProviderState::Connected,
        );
    }

    // 7. Another build is never run; another model is refused before any request.
    let other_binary = dir.path().join("other/codex");
    fs::create_dir_all(other_binary.parent().unwrap()).unwrap();
    fs::copy("/bin/echo", &other_binary).unwrap();
    let other = Arc::new(Codex::for_test(
        dir.path().join("other-root"),
        vec![other_binary],
        Pin::qualified(),
    ));
    let other_provider = CodexProvider(Arc::clone(&other));
    let other_turn = qualified_turn(&other_provider, &format!("{MISMATCH}: other build"));
    check(
        "mismatch.otherBuildUnsupported",
        other_provider.snapshot().state
            == ProviderState::Unavailable {
                reason: UnavailableReason::UnsupportedVersion,
                installed_version: None,
            },
    );
    check(
        "mismatch.otherBuildNeverRun",
        other.spawns() == 0 && other_turn.outcome == failed(Failure::ProviderFailed),
    );
    let mismatch_root =
        user.join("Library/Application Support/LeadingLight-mismatch/adapt/provider/codex");
    let mismatched = Arc::new(Codex::with(
        mismatch_root,
        qualification_settings(&binary, &user, &loopback, "gpt-5.4"),
    ));
    mismatched.assume_connected();
    let mismatched_provider = CodexProvider(Arc::clone(&mismatched));
    let mismatch = qualified_turn(&mismatched_provider, &format!("{MISMATCH}: other model"));
    check(
        "mismatch.otherModelRefused",
        mismatch.outcome == failed(Failure::ProviderFailed),
    );
    check(
        "mismatch.otherModelNoRequest",
        group_of(&loopback.received(), MISMATCH).is_empty(),
    );
    check(
        "mismatch.otherModelGroupGone",
        mismatched.last_group_gone() == Some(true),
    );

    // Across everything.
    let received = loopback.received();
    let served: Vec<&loopback::Received> = received
        .iter()
        .filter(|request| request.answer != "notServed")
        .collect();
    let everything: String = received
        .iter()
        .map(|request| request.text.as_str())
        .collect();
    let advertised: BTreeSet<String> = served
        .iter()
        .flat_map(|request| loopback::advertised_tools(&request.body))
        .collect();
    check(
        "all.onlyQualifiedTools",
        advertised.is_subset(&tools_allowed),
    );
    check(
        "all.dummyKeyOnly",
        !served.is_empty() && served.iter().all(|request| request.dummy_auth),
    );
    check("all.noExternalRequest", loopback.external().is_empty());
    check(
        "all.noSentinelSent",
        canaries
            .values()
            .all(|canary| !everything.contains(&canary.sentinel)),
    );
    check(
        "all.noAncestorCanarySent",
        ancestor_tokens
            .iter()
            .all(|token| !everything.contains(token)),
    );
    check(
        "all.noSkillMetadata",
        !everything.contains("skills_instructions") && !everything.contains("skills/.system/"),
    );
    check(
        "all.noUnexpectedAnswer",
        served
            .iter()
            .all(|request| request.answer != "unexpected" && request.answer != "addFollowUp"),
    );
    check(
        "all.notesUnchanged",
        canaries
            .iter()
            .all(|(key, canary)| file_state(&canary.path) == before[key]),
    );
    check(
        "all.noDestinationWritten",
        !added.exists() && !moved.exists(),
    );
    check(
        "all.workingFolderEmpty",
        fs::read_dir(layout.run()).unwrap().next().is_none(),
    );
    check(
        "all.providerStillQualified",
        provider.snapshot().state == ProviderState::Connected,
    );
    let root_text = dir
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    evidence.insert("binarySha256".into(), json!(controls::PINNED_SHA256));
    evidence.insert("model".into(), json!(MODEL));
    evidence.insert("checks".into(), json!(checks));
    evidence.insert("advertisedTools".into(), json!(advertised));
    evidence.insert(
        "answers".into(),
        json!(served
            .iter()
            .map(|request| request.answer.clone())
            .collect::<Vec<_>>()),
    );
    evidence.insert(
        "otherLoopbackRequests".into(),
        json!(received
            .iter()
            .filter(|request| request.answer == "notServed")
            .map(|request| format!("{} {}", request.method, request.path))
            .collect::<Vec<_>>()),
    );
    evidence.insert(
        "outcomes".into(),
        json!({
            "benign": format!("{:?}", benign.outcome),
            "foreign": format!("{:?}", foreign.outcome),
            "add": format!("{:?}", add.outcome),
            "question": format!("{:?}", question.outcome),
            "cancel": format!("{cancelled:?}"),
            "mismatch": format!("{:?}", mismatch.outcome),
        }),
    );
    evidence.insert(
        "elapsedMs".into(),
        json!({
            "benign": benign.elapsed.as_millis() as u64,
            "foreign": foreign.elapsed.as_millis() as u64,
            "add": add.elapsed.as_millis() as u64,
            "question": question.elapsed.as_millis() as u64,
        }),
    );
    if let Some(path) = std::env::var_os(QUALIFICATION_EVIDENCE) {
        let text = serde_json::to_string_pretty(&Value::Object(evidence))
            .unwrap()
            .replace(&root_text, "<ROOT>")
            .replace(&*dir.path().to_string_lossy(), "<ROOT>");
        fs::write(path, text + "\n").unwrap();
    }
    let failed_checks: Vec<&String> = checks
        .iter()
        .filter(|(_, passed)| !**passed)
        .map(|(name, _)| name)
        .collect();
    assert!(
        failed_checks.is_empty(),
        "qualification checks failed: {failed_checks:?}"
    );
}
