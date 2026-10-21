//! The provider process and the one binary it may be.
//!
//! The process gets LeadingLight's private provider folders and nothing else: its own home and
//! Codex home, a temporary folder, and one shared working folder that stays empty and is never a
//! vault. Its environment is a fixed list (nothing inherited: no keys, proxies, provider URLs, Node
//! or shell settings), and it runs in its own process group. Ending it kills the whole group,
//! confirms that nothing in the group still runs, and reaps it.
//!
//! The binary is the qualified native build only, found by its exact SHA-256 among a fixed set of
//! install locations. Any other file there is reported and never run, not even for `--version`.

use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::super::store::private_dir;
use super::controls;

/// How long the group may take to be gone after it is killed.
const GROUP_WAIT: Duration = Duration::from_millis(5_000);
const GROUP_POLL: Duration = Duration::from_millis(20);
/// Node installations looked at under one version manager.
const MAX_NODE_VERSIONS: usize = 64;
const HASH_CHUNK: usize = 1024 * 1024;

/// LeadingLight's private provider folders, by their resolved paths.
#[derive(Debug, Clone)]
pub(crate) struct Layout {
    root: PathBuf,
}

impl Layout {
    /// Creates the private folders under `root` and resolves it, so every path the provider is
    /// given and every path checked is the real one.
    pub(crate) fn prepare(root: &Path) -> std::io::Result<Self> {
        private_dir(root)?;
        let layout = Self {
            root: root.canonicalize()?,
        };
        for dir in [
            layout.home(),
            layout.codex_home(),
            layout.tmp(),
            layout.run(),
        ] {
            private_dir(&dir)?;
        }
        Ok(layout)
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// The provider's `HOME`.
    pub(crate) fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    /// The provider's `CODEX_HOME`: its configuration, its runtime files and its own sign-in.
    pub(crate) fn codex_home(&self) -> PathBuf {
        self.home().join("codex")
    }

    pub(crate) fn tmp(&self) -> PathBuf {
        self.root.join("tmp")
    }

    /// The working folder. It is the only folder the `adapt` profile lets the model read, and it
    /// is always empty.
    pub(crate) fn run(&self) -> PathBuf {
        self.root.join("run")
    }

    pub(crate) fn config_file(&self) -> PathBuf {
        self.codex_home().join("config.toml")
    }

    /// The provider's own sign-in file, inside LeadingLight's private provider home only.
    pub(crate) fn auth_file(&self) -> PathBuf {
        self.codex_home().join("auth.json")
    }
}

/// Every variable the provider process sees, as qualified. Nothing else is inherited.
pub(crate) fn environment(layout: &Layout) -> Vec<(String, OsString)> {
    let fixed = [
        ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        ("LANG", "en_US.UTF-8"),
        ("SHELL", "/bin/zsh"),
        ("USER", "leadinglight"),
        ("LOGNAME", "leadinglight"),
    ];
    let mut variables = vec![
        ("HOME".to_string(), layout.home().into_os_string()),
        (
            "CODEX_HOME".to_string(),
            layout.codex_home().into_os_string(),
        ),
        ("TMPDIR".to_string(), layout.tmp().into_os_string()),
    ];
    variables.extend(
        fixed
            .iter()
            .map(|(key, value)| (key.to_string(), OsString::from(value))),
    );
    variables
}

/// The provider command: the fixed environment plus `extra` (only the offline qualification has
/// any), the empty working folder, piped streams and a process group of its own.
pub(crate) fn command(
    binary: &Path,
    layout: &Layout,
    args: &[String],
    extra: &[(String, OsString)],
) -> Command {
    let mut command = Command::new(binary);
    command
        .env_clear()
        .envs(environment(layout))
        .envs(extra.iter().map(|(key, value)| (key, value)))
        .current_dir(layout.run())
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Whether any process of a group other than a zombie still exists; `None` if it cannot be told.
pub(crate) type GroupCheck<'a> = &'a dyn Fn(u32) -> Option<bool>;

/// A running provider process. Its error output is read and discarded, never logged: it may echo
/// what was sent.
pub(crate) struct Process {
    child: Child,
    /// An end was attempted.
    ended: bool,
    /// Its group was proven gone and it was reaped.
    reaped: bool,
}

impl Process {
    pub(crate) fn spawn(mut command: Command) -> std::io::Result<(Self, ChildStdin, ChildStdout)> {
        let mut child = command.spawn()?;
        let streams = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        let mut process = Self {
            child,
            ended: false,
            reaped: false,
        };
        let (Some(stdin), Some(stdout), Some(stderr)) = streams else {
            process.end();
            return Err(std::io::Error::other(
                "the provider's streams were not available",
            ));
        };
        let discard = std::thread::Builder::new()
            .name("leadinglight-adapt-stderr".to_string())
            .spawn(move || {
                let mut stderr = stderr;
                let mut chunk = [0_u8; 8192];
                while matches!(stderr.read(&mut chunk), Ok(read) if read > 0) {}
            });
        if discard.is_err() {
            process.end();
            return Err(std::io::Error::other(
                "the provider's error output could not be read",
            ));
        }
        Ok((process, stdin, stdout))
    }

    /// Kills the provider and its whole process group and waits, within a bound, until nothing in
    /// the group still runs; only then is the provider reaped. Answers whether the group was proven
    /// gone.
    ///
    /// The provider is reaped only after that proof: until then its id stays taken, so the group
    /// signalled is always its own and never a later process that happens to get the same id.
    pub(crate) fn end(&mut self) -> bool {
        self.end_with(&group_running, GROUP_WAIT)
    }

    /// Its process group id, which is its own id.
    #[cfg(test)]
    pub(crate) fn id(&self) -> u32 {
        self.child.id()
    }

    /// `end`, with the group check and the bound given.
    pub(crate) fn end_with(&mut self, running: GroupCheck<'_>, wait: Duration) -> bool {
        if self.reaped {
            return true;
        }
        self.ended = true;
        let _ = self.child.kill();
        if !end_group(self.child.id(), running, wait) {
            return false;
        }
        let _ = self.child.wait();
        self.reaped = true;
        true
    }
}

impl Drop for Process {
    /// Every caller ends the process first; this is the last resort on an early return. Nothing
    /// here waits beyond that bound: a provider not proven gone is reaped only if it has already
    /// exited, and is never signalled again.
    fn drop(&mut self) {
        if !self.ended {
            self.end();
        }
        if !self.reaped {
            let _ = self.child.try_wait();
        }
    }
}

#[cfg(unix)]
fn end_group(group: u32, running: GroupCheck<'_>, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    loop {
        let _ = Command::new("/bin/kill")
            .env_clear()
            .args(["-s", "KILL", "--", &format!("-{group}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if running(group) == Some(false) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(GROUP_POLL);
    }
}

#[cfg(not(unix))]
fn end_group(_group: u32, _running: GroupCheck<'_>, _wait: Duration) -> bool {
    false
}

#[cfg(not(unix))]
pub(crate) fn group_running(_group: u32) -> Option<bool> {
    None
}

/// Whether any process of `group` other than a zombie still exists; `None` if it cannot be told.
#[cfg(unix)]
pub(crate) fn group_running(group: u32) -> Option<bool> {
    let output = Command::new("/bin/ps")
        .env_clear()
        .args(["-axo", "pid=,pgid=,stat="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let listing = String::from_utf8_lossy(&output.stdout);
    let group = group.to_string();
    Some(listing.lines().any(|line| {
        let mut columns = line.split_whitespace();
        let (_pid, pgid, stat) = (columns.next(), columns.next(), columns.next());
        pgid == Some(group.as_str()) && stat.is_some_and(|stat| !stat.starts_with('Z'))
    }))
}

// --- The binary --------------------------------------------------------------------------------

/// The build a binary must be: its exact size and SHA-256.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pin {
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
}

impl Pin {
    pub(crate) fn qualified() -> Self {
        Self {
            sha256: controls::PINNED_SHA256.to_string(),
            bytes: controls::PINNED_BYTES,
        }
    }
}

/// A file's identity. If any part of it changes, the file is verified again before it is run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileId {
    device: u64,
    inode: u64,
    bytes: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

/// The identity of the regular file at `path`, following links.
#[cfg(unix)]
pub(crate) fn file_id(path: &Path) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path).ok()?;
    meta.is_file().then(|| FileId {
        device: meta.dev(),
        inode: meta.ino(),
        bytes: meta.size(),
        modified: (meta.mtime(), meta.mtime_nsec()),
        changed: (meta.ctime(), meta.ctime_nsec()),
    })
}

#[cfg(not(unix))]
pub(crate) fn file_id(_path: &Path) -> Option<FileId> {
    None
}

/// A binary verified to be the pinned build, by its resolved path and identity at that time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pinned {
    pub(crate) path: PathBuf,
    pub(crate) id: FileId,
}

impl Pinned {
    /// Whether the file is still exactly the one that was verified.
    pub(crate) fn unchanged(&self) -> bool {
        file_id(&self.path) == Some(self.id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Discovery {
    /// No file at any install location.
    Missing,
    /// A Codex is installed, but none of it is the pinned build. Nothing was run.
    Unpinned,
    Pinned(Pinned),
}

/// Every place a Codex binary is looked for: the npm native payload under each known Node prefix,
/// then the other native installs, which can only ever be reported as another build.
pub(crate) fn candidates(user_home: Option<&Path>) -> Vec<PathBuf> {
    let mut prefixes = vec![PathBuf::from("/opt/homebrew"), PathBuf::from("/usr/local")];
    if let Some(home) = user_home {
        prefixes.push(home.join(".npm-global"));
        prefixes.push(home.join(".local"));
        let fnm = [
            home.join(".local/share/fnm/node-versions"),
            home.join("Library/Application Support/fnm/node-versions"),
        ];
        for versions in fnm {
            prefixes.extend(
                installations(&versions)
                    .into_iter()
                    .map(|version| version.join("installation")),
            );
        }
        prefixes.extend(installations(&home.join(".nvm/versions/node")));
    }
    let mut found: Vec<PathBuf> = prefixes
        .iter()
        .flat_map(|prefix| {
            controls::NPM_PAYLOADS
                .iter()
                .map(move |payload| prefix.join(payload))
        })
        .collect();
    found.extend(controls::OTHER_INSTALLS.iter().map(PathBuf::from));
    found
}

/// The version folders under one Node version manager, in name order, at most a bounded number.
fn installations(versions: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(versions) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .take(MAX_NODE_VERSIONS)
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

/// The first candidate that is the pinned build. Files are only measured and hashed, never run.
pub(crate) fn discover(candidates: &[PathBuf], pin: &Pin) -> Discovery {
    let mut installed = false;
    for candidate in candidates {
        let Ok(resolved) = candidate.canonicalize() else {
            continue;
        };
        let Some(id) = file_id(&resolved) else {
            continue;
        };
        installed = true;
        if is_pinned(&resolved, id, pin) {
            return Discovery::Pinned(Pinned { path: resolved, id });
        }
    }
    if installed {
        Discovery::Unpinned
    } else {
        Discovery::Missing
    }
}

/// The exact size, then the exact hash, and the file unchanged while it was read.
fn is_pinned(path: &Path, id: FileId, pin: &Pin) -> bool {
    id.bytes == pin.bytes
        && sha256_file(path).is_some_and(|digest| digest == pin.sha256)
        && file_id(path) == Some(id)
}

/// The lowercase hex SHA-256 of a file, read in bounded chunks.
pub(crate) fn sha256_file(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut chunk = vec![0_u8; HASH_CHUNK];
    loop {
        match file.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => hasher.update(&chunk[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
    let digest = hasher.finalize();
    Some(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}
