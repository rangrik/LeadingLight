//! The website vocabulary natively: the TypeScript corpus and its answers word for word where the
//! TypeScript suite fixes them, the capability guard that offers `web.capture` only behind its own
//! flag, the bundled recipe, and a website run saving through the existing exclusive create. No
//! network: native validation never fetches, and the save is a plain create.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::manifest::{
    host_capabilities, missing_capabilities, validate, Capability, HOST_SERVICES_QUALIFIED,
    NATIVE_CAPABILITIES, WEBSITE_SERVICES_QUALIFIED,
};
use super::report::Code;
use super::store::{NativeStoreIo, Store};
use super::wire::{ActivationRefusal, ImportReply, RunRefusal};

const WEBSITE: &str = "leadinglight.website-capture";
const COMMENTARY: &str = "leadinglight.passage-commentary";
const VAULT: &str = "/vault";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/leadinglight/extensions/fixtures")
}

fn fixture(name: &str) -> String {
    fs::read_to_string(fixtures().join(name)).unwrap()
}

fn code_name(code: Code) -> String {
    serde_json::to_value(code)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

fn problems(text: &str) -> Vec<(String, String)> {
    match validate(text) {
        Ok(_) => Vec::new(),
        Err(list) => list
            .into_iter()
            .map(|diagnostic| (code_name(diagnostic.code), diagnostic.path))
            .collect(),
    }
}

fn one(code: &str, path: &str) -> Vec<(String, String)> {
    vec![(code.to_string(), path.to_string())]
}

/// The first diagnostic's message.
fn message(text: &str) -> String {
    validate(text).unwrap_err().remove(0).message
}

fn website() -> Value {
    serde_json::from_str(&fixture("website-capture.json")).unwrap()
}

fn edited(change: impl FnOnce(&mut Value)) -> String {
    let mut package = website();
    change(&mut package);
    package.to_string()
}

fn reference(step: &str, field: &str) -> Value {
    json!({ "step": step, "field": field })
}

fn object_pointers(value: &Value, pointer: String, found: &mut Vec<String>) {
    match value {
        Value::Object(members) => {
            found.push(pointer.clone());
            for (key, item) in members {
                object_pointers(item, format!("{pointer}/{key}"), found);
            }
        }
        Value::Array(items) => {
            for (position, item) in items.iter().enumerate() {
                object_pointers(item, format!("{pointer}/{position}"), found);
            }
        }
        _ => {}
    }
}

// --- Validation, as the TypeScript validator answers ----------------------------------------------

#[test]
fn website_corpus_gets_the_typescript_validators_answers() {
    let cases: Value = serde_json::from_str(&fixture("web-capture-cases.json")).unwrap();
    for name in cases["valid"].as_array().unwrap() {
        let name = name.as_str().unwrap();
        assert_eq!(problems(&fixture(name)), Vec::new(), "{name}");
    }
    let invalid = cases["invalid"].as_array().unwrap();
    assert_eq!(invalid.len(), 11);
    for case in invalid {
        let file = case["file"].as_str().unwrap();
        let expected = one(
            case["code"].as_str().unwrap(),
            case["path"].as_str().unwrap(),
        );
        assert_eq!(problems(&fixture(file)), expected, "{file}");
        assert!(message(&fixture(file)).ends_with('.'), "{file}");
    }
}

#[test]
fn takes_no_address_header_method_credential_or_option_from_a_package() {
    for key in [
        "url",
        "headers",
        "method",
        "credentials",
        "cookies",
        "script",
        "options",
        "automatic",
        "networkOptions",
        "body",
        "proxy",
    ] {
        let text = edited(|package| package["commands"][0]["steps"][0][key] = json!("x"));
        assert_eq!(
            problems(&text),
            one("unknownField", &format!("/commands/0/steps/0/{key}")),
            "{key}"
        );
    }
    let original = website();
    let mut pointers = Vec::new();
    object_pointers(&original, String::new(), &mut pointers);
    assert!(pointers.len() > 10);
    for pointer in pointers {
        let mut changed = original.clone();
        let target = changed
            .pointer_mut(&pointer)
            .unwrap()
            .as_object_mut()
            .unwrap();
        target.insert("extra".to_string(), Value::Bool(true));
        assert_eq!(
            problems(&changed.to_string()),
            one("unknownField", &format!("{pointer}/extra")),
            "at {pointer}"
        );
    }
    assert!(message(&fixture("invalid/web-url-in-step.json")).contains("its fields are id, op"));
}

#[test]
fn saves_a_page_only_as_a_new_note_with_one_capture() {
    assert_eq!(
        message(&fixture("invalid/web-append.json")),
        "A web page is saved only as a new note in a folder the person chooses; use newInChosenFolder."
    );
    assert_eq!(
        problems(&fixture("invalid/web-associated.json")),
        one("notAllowed", "/commands/0/steps/2/policy")
    );
    let steps = website()["commands"][0]["steps"].clone();
    let (page, notes, place, save) = (&steps[0], &steps[1], &steps[2], &steps[4]);
    let mut note = steps[3].clone();
    note["blocks"] = json!([{ "type": "paragraph", "text": ["Saved."] }]);
    let passage = json!({ "id": "passage", "op": "capturePassage" });
    let with_steps = |list: Value| {
        edited(|package| {
            package["capabilities"] = json!(["selection.read", "document.create", "web.capture"]);
            package["commands"][0]["steps"] = list;
        })
    };
    let both = with_steps(json!([passage, page, place, note, save]));
    assert_eq!(problems(&both), one("notAllowed", "/commands/0/steps/1/op"));
    assert_eq!(
        message(&both),
        "A command captures either a passage or a web page, not both; keep one of the two steps."
    );
    let reversed = with_steps(json!([page, passage, place, note, save]));
    assert_eq!(
        problems(&reversed),
        one("stepOrder", "/commands/0/steps/1/op")
    );
    let without_page =
        edited(|package| package["commands"][0]["steps"] = json!([notes, place, steps[3], save]));
    assert_eq!(
        problems(&without_page),
        one("unboundReference", "/commands/0/steps/2/title/0/step")
    );
}

#[test]
fn offers_the_page_values_by_where_they_may_be_used() {
    let title = |field: &str| {
        edited(|package| {
            package["commands"][0]["steps"][3]["title"] =
                json!(["Read: ", reference("page", field)]);
        })
    };
    for field in ["pageTitle", "pageUrl", "siteName"] {
        assert_eq!(problems(&title(field)), Vec::new(), "{field}");
    }
    assert_eq!(
        problems(&title("byline")),
        one("incompatibleReference", "/commands/0/steps/3/title/1")
    );
    assert_eq!(
        message(&title("byline")),
        "A page's \"byline\" is not always known; use it in a heading, paragraph or list, not the title."
    );
    let blocks = edited(|package| {
        package["commands"][0]["steps"][3]["blocks"] = json!([
            { "type": "heading", "level": 3, "text": ["By ", reference("page", "byline")], "ifFilled": reference("page", "byline") },
            { "type": "paragraph", "text": [reference("page", "siteName"), " · ", reference("page", "pageUrl")] },
            { "type": "quote", "text": [reference("page", "pageTitle")] },
            { "type": "list", "style": "bullet", "items": [["Site: ", reference("page", "siteName")], ["By: ", reference("page", "byline")]] }
        ]);
    });
    assert_eq!(problems(&blocks), Vec::new());
    for field in [
        "article",
        "body",
        "html",
        "markdown",
        "url",
        "source",
        "provenance",
        "fetchedAt",
    ] {
        let text = edited(|package| {
            package["commands"][0]["steps"][3]["blocks"] =
                json!([{ "type": "paragraph", "text": [reference("page", field)] }]);
        });
        assert_eq!(
            problems(&text),
            one(
                "unboundReference",
                "/commands/0/steps/3/blocks/0/text/0/field"
            ),
            "{field}"
        );
    }
    assert!(message(&fixture("invalid/web-page-body-reference.json"))
        .contains("its fields are pageTitle, pageUrl, siteName, byline."));
}

#[test]
fn never_lets_a_package_write_the_host_page_block() {
    assert_eq!(
        message(&fixture("invalid/web-forged-article.json")),
        "A block type webArticle is not supported; use one of heading, paragraph, quote, list. The host adds the web page block itself."
    );
    let source = edited(|package| {
        package["commands"][0]["steps"][3]["blocks"] =
            json!([{ "type": "source", "passage": "p", "quote": "q" }]);
    });
    assert_eq!(
        problems(&source),
        one("unsupportedValue", "/commands/0/steps/3/blocks/0/type")
    );
}

#[test]
fn declared_capabilities_equal_what_the_steps_use_in_canonical_order() {
    let mut quick: Value = serde_json::from_str(&fixture("quick-note.json")).unwrap();
    let declared = quick["capabilities"].as_array_mut().unwrap();
    declared.push(json!("web.capture"));
    let last = declared.len() - 1;
    assert_eq!(
        problems(&quick.to_string()),
        one("unusedCapability", &format!("/capabilities/{last}"))
    );
    let shuffled = edited(|package| {
        package["capabilities"] = json!(["web.capture", "document.open", "document.create"]);
    });
    let manifest = validate(&shuffled).unwrap();
    let website_capabilities = [
        Capability::DocumentCreate,
        Capability::DocumentOpen,
        Capability::WebCapture,
    ];
    assert_eq!(manifest.capabilities, website_capabilities);
    assert_eq!(manifest.commands[0].capabilities, website_capabilities);
    // Six capabilities fit the list; a seventh entry is one too many.
    let all_six = edited(|package| {
        package["capabilities"] = json!([
            "selection.read",
            "association.resolve",
            "document.create",
            "document.append",
            "document.open",
            "web.capture"
        ]);
    });
    assert_eq!(
        problems(&all_six),
        [
            one("unusedCapability", "/capabilities/0"),
            one("unusedCapability", "/capabilities/1"),
            one("unusedCapability", "/capabilities/3"),
        ]
        .concat()
    );
    let seven = edited(|package| {
        package["capabilities"] = json!([
            "selection.read",
            "association.resolve",
            "document.create",
            "document.append",
            "document.open",
            "web.capture",
            "web.capture"
        ]);
    });
    assert_eq!(problems(&seven), one("tooMany", "/capabilities"));
}

#[test]
fn appends_web_capture_last_without_changing_the_e1_and_e2_words() {
    let names: Vec<&str> = Capability::ALL.into_iter().map(Capability::name).collect();
    assert_eq!(
        names,
        [
            "selection.read",
            "association.resolve",
            "document.create",
            "document.append",
            "document.open",
            "web.capture"
        ]
    );
    assert_eq!(
        serde_json::to_value(Capability::WebCapture).unwrap(),
        json!("web.capture")
    );
    assert_eq!(
        message(&fixture("invalid/second-write.json")),
        "Steps run in the order capturePassage, collectForm, resolveDestination, composeDocument, proposeDocument, openCommittedResult, each at most once; this proposeDocument is out of place."
    );
    assert_eq!(
        message(&fixture("invalid/forged-source-block.json")),
        "A block type source is not supported; use one of heading, paragraph, quote, list. The host adds the source block itself."
    );
    assert!(message(&fixture("invalid/optional-in-title.json")).contains("make \""));
    assert_eq!(
        message(&fixture("invalid/web-capture-after-form.json")),
        "Steps run in the order captureWebPage, collectForm, resolveDestination, composeDocument, proposeDocument, openCommittedResult, each at most once; this captureWebPage is out of place."
    );
}

#[test]
fn the_bundled_website_recipe_is_the_shared_fixture_under_a_reserved_id() {
    let bundled_text = include_str!("bundled/website-capture.json");
    let bundled: Value = serde_json::from_str(bundled_text).unwrap();
    let mut shared = website();
    shared["id"] = Value::String(WEBSITE.to_string());
    assert_eq!(bundled, shared);
    let manifest = validate(bundled_text).unwrap();
    assert_eq!(manifest.name, "Save from website");
    assert_eq!(manifest.commands.len(), 1);
    assert_eq!(manifest.commands[0].id, "save-page");
    assert_eq!(
        manifest.capabilities,
        [
            Capability::DocumentCreate,
            Capability::DocumentOpen,
            Capability::WebCapture
        ]
    );
}

// --- The capability guard -------------------------------------------------------------------------

#[test]
fn web_capture_is_offered_only_by_its_own_flag() {
    let host = host_capabilities();
    assert_eq!(
        host.contains(&Capability::WebCapture),
        WEBSITE_SERVICES_QUALIFIED
    );
    assert_eq!(
        host.contains(&Capability::SelectionRead),
        HOST_SERVICES_QUALIFIED
    );
    assert!(NATIVE_CAPABILITIES
        .iter()
        .all(|capability| host.contains(capability)));
    let website = validate(&fixture("website-capture.json")).unwrap();
    let missing = missing_capabilities(&website.capabilities);
    assert_eq!(missing.is_empty(), WEBSITE_SERVICES_QUALIFIED);
    assert!(missing
        .iter()
        .all(|capability| *capability == Capability::WebCapture));
}

fn store_with(dir: &Path, host: Vec<Capability>) -> Store {
    Store::with_host(dir.join("store"), Box::new(NativeStoreIo), host)
}

fn active(store: &Store, package_id: &str) -> Option<String> {
    store
        .list(VAULT)
        .into_iter()
        .find(|extension| extension.package_id == package_id)
        .unwrap()
        .active_sha256
}

/// Neither native alone nor a host qualified only for the E2 services turns the website on.
#[test]
fn an_unqualified_host_lists_the_website_recipe_but_never_turns_it_on() {
    let e2_qualified: Vec<Capability> = NATIVE_CAPABILITIES
        .into_iter()
        .chain([Capability::SelectionRead, Capability::AssociationResolve])
        .collect();
    for host in [NATIVE_CAPABILITIES.to_vec(), e2_qualified.clone()] {
        let dir = tempfile::tempdir().unwrap();
        let store = store_with(dir.path(), host.clone());
        let sha = store.bundled_hash(WEBSITE).unwrap();
        assert_eq!(active(&store, WEBSITE), None);
        assert_eq!(
            store.admit(VAULT, &sha, "save-page"),
            Err(RunRefusal::NotActive)
        );
        match store.activate(VAULT, WEBSITE, &sha, None) {
            Err((ActivationRefusal::MissingCapabilities, missing)) => {
                assert_eq!(missing, [Capability::WebCapture]);
            }
            other => panic!("{:?}", other.err()),
        }
        match store.import(&fixture("website-capture.json")) {
            ImportReply::Candidate {
                missing_capabilities,
                ..
            } => assert_eq!(missing_capabilities, [Capability::WebCapture]),
            other => panic!("{other:?}"),
        }
        assert_eq!(active(&store, "local.website-capture"), None);
        assert_eq!(active(&store, WEBSITE), None);
    }
    // The E2 services alone still turn the commentary on: the two flags are independent.
    let dir = tempfile::tempdir().unwrap();
    let store = store_with(dir.path(), e2_qualified);
    assert!(active(&store, COMMENTARY).is_some());
    assert_eq!(active(&store, WEBSITE), None);
}

/// This build performs all six capabilities: three natively, the E2 passage and association
/// services, and website capture. Its own host turns the bundled website recipe and commentary on
/// by default where they were never turned off, without writing preferences, and admits a website
/// run.
#[test]
fn this_build_performs_web_capture_and_turns_the_website_recipe_on() {
    assert_eq!(host_capabilities(), Capability::ALL);
    let website = validate(&fixture("website-capture.json")).unwrap();
    assert!(missing_capabilities(&website.capabilities).is_empty());
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("store"));
    let sha = store.bundled_hash(WEBSITE).unwrap();
    assert_eq!(active(&store, WEBSITE).as_deref(), Some(sha.as_str()));
    assert!(active(&store, COMMENTARY).is_some());
    assert_eq!(
        store.admit(VAULT, &sha, "save-page"),
        Ok(WEBSITE.to_string())
    );
    assert!(!store.preferences_file().exists());
}

#[test]
fn a_qualified_host_turns_the_website_recipe_on_by_default() {
    let dir = tempfile::tempdir().unwrap();
    let store = store_with(dir.path(), Capability::ALL.to_vec());
    let sha = store.bundled_hash(WEBSITE).unwrap();
    assert_eq!(active(&store, WEBSITE).as_deref(), Some(sha.as_str()));
    assert_eq!(
        store.admit(VAULT, &sha, "save-page"),
        Ok(WEBSITE.to_string())
    );
    assert!(!store.preferences_file().exists());
}

// --- Saving: the existing exclusive create, nothing new -------------------------------------------

#[cfg(unix)]
mod saving {
    use std::fs;

    use super::super::create::NativeCreateIo;
    use super::super::wire::{
        CommitKind, ConflictReason, FolderHandleReply, GuardedProposal, ListReply,
        OpenSessionReply, ProposalReceipt, RunAdmission,
    };
    use super::super::{hex, test_roots, BeginRequest, Extensions};
    use super::{Capability, WEBSITE};
    use crate::vault::staged_file::sha256;

    /// What the trusted host composes in the webview: the converted page, then the package's
    /// blocks. Native sees only these bytes.
    const NOTE: &str = "---\nsource: https://example.org/2026/10/article\ncaptured: 2026-10-20\n_leadinglight_capture:\n  version: 1\n---\n# Why we sleep\n\nSaved from [Example Site](https://example.org/2026/10/article) on 2026-10-20.\n\nThe article text.\n\n## My notes\n\nWanted this for the chapter on rest.\n";

    fn create(operation_id: &str, run_id: &str, folder: &str, text: &str) -> GuardedProposal {
        GuardedProposal::Create {
            operation_id: operation_id.to_string(),
            run_id: run_id.to_string(),
            content: text.to_string(),
            content_sha256: hex(&sha256(text.as_bytes())),
            folder_handle: folder.to_string(),
            file_name: "why-we-sleep.md".to_string(),
        }
    }

    fn admitted(
        extensions: &Extensions,
        roots_path: &std::path::Path,
        key: &str,
    ) -> (String, String) {
        let roots = test_roots(roots_path);
        let ListReply::Ok { extensions: listed } = extensions.list(Some(&roots)) else {
            panic!("the vault lists");
        };
        let sha = listed
            .iter()
            .find(|extension| extension.package_id == WEBSITE)
            .and_then(|extension| extension.active_sha256.clone())
            .expect("the website recipe is on where the host performs web.capture");
        let OpenSessionReply::Open { session_id } = extensions.open_session("main", Some(&roots))
        else {
            panic!("the session opens");
        };
        let request = BeginRequest {
            session_id,
            package_sha256: sha,
            command_id: "save-page".to_string(),
            invocation_id: key.to_string(),
        };
        let RunAdmission::Admitted { scope } = extensions.begin_run("main", &request) else {
            panic!("the website run is admitted");
        };
        let FolderHandleReply::Bound { folder_handle, .. } =
            extensions.bind_folder("main", &scope.run_id, "Reading")
        else {
            panic!("the folder binds");
        };
        (scope.run_id, folder_handle)
    }

    #[test]
    fn a_website_run_saves_once_through_the_exclusive_create_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        fs::create_dir_all(vault.join("Reading")).unwrap();
        let extensions = Extensions::with_host(
            dir.path().join("store"),
            Box::new(NativeCreateIo),
            Capability::ALL.to_vec(),
        );

        let (run, folder) = admitted(&extensions, &vault, "k1");
        let operation = uuid::Uuid::new_v4().to_string();
        match extensions.submit("main", &create(&operation, &run, &folder, NOTE)) {
            ProposalReceipt::Committed {
                kind,
                path,
                undo_receipt,
                ..
            } => {
                assert_eq!(kind, CommitKind::Create);
                assert_eq!(
                    path,
                    vault.join("Reading/why-we-sleep.md").to_string_lossy()
                );
                // The ordinary guarded create Undo is offered, as for any created note.
                assert!(undo_receipt.is_some());
            }
            other => panic!("{other:?}"),
        }
        let page = vault.join("Reading/why-we-sleep.md");
        assert_eq!(fs::read_to_string(&page).unwrap(), NOTE);

        // A second save of the same name, from a new run, is a conflict: nothing is replaced.
        let (again, folder) = admitted(&extensions, &vault, "k2");
        let other = uuid::Uuid::new_v4().to_string();
        let receipt = extensions.submit(
            "main",
            &create(&other, &again, &folder, "# Something else\n"),
        );
        assert_eq!(
            receipt,
            ProposalReceipt::Conflict {
                operation_id: other,
                reason: ConflictReason::Exists
            }
        );
        assert_eq!(fs::read_to_string(&page).unwrap(), NOTE);
    }
}
