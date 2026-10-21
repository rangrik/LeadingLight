//! Native validation against the shared corpus the TypeScript validator uses
//! (`src/leadinglight/extensions/fixtures`), plus the boundaries its own suite checks.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::manifest::{
    host_capabilities, missing_capabilities, missing_from, validate, Capability,
    NATIVE_CAPABILITIES,
};
use super::report::Code;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/leadinglight/extensions/fixtures")
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(fixtures().join(name)).unwrap()
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

#[test]
fn shared_corpus_gets_the_typescript_validators_answers() {
    let cases: Value = serde_json::from_str(&fixture("cases.json")).unwrap();
    for name in cases["valid"].as_array().unwrap() {
        let name = name.as_str().unwrap();
        assert_eq!(problems(&fixture(name)), Vec::new(), "{name}");
    }
    for case in cases["invalid"].as_array().unwrap() {
        let file = case["file"].as_str().unwrap();
        let expected = one(
            case["code"].as_str().unwrap(),
            case["path"].as_str().unwrap(),
        );
        assert_eq!(problems(&fixture(file)), expected, "{file}");
    }
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

#[test]
fn rejects_an_unknown_field_at_every_nesting_level() {
    for name in [
        "meeting-debrief.json",
        "passage-commentary.json",
        "append-observation.json",
    ] {
        let original: Value = serde_json::from_str(&fixture(name)).unwrap();
        let mut pointers = Vec::new();
        object_pointers(&original, String::new(), &mut pointers);
        assert!(pointers.len() > 10, "{name}");
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
                "{name} at {pointer}"
            );
        }
    }
}

#[test]
fn reads_numbers_only_as_plain_safe_integers() {
    let text = fixture("meeting-debrief.json");
    let path = "/commands/0/steps/2/blocks/1/level";
    let with_level =
        |level: &str| text.replacen("\"level\": 2,", &format!("\"level\": {level},"), 1);
    for level in ["2.5", "2.0", "2E0", "-0", "1e400", "9007199254740993"] {
        assert_eq!(
            problems(&with_level(level)),
            one("invalidNumber", path),
            "{level}"
        );
    }
    assert_eq!(problems(&with_level("\"2\"")), one("wrongType", path));
    assert_eq!(problems(&with_level("5")), one("unsupportedValue", path));
    assert_eq!(problems(&with_level("3")), Vec::new());
}

#[test]
fn bounds_nesting_on_the_text_including_a_member_a_duplicate_replaces() {
    let text = fixture("quick-note.json");
    let hidden = |depth: usize| {
        let nested = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        text.replacen(
            "\"description\":",
            &format!("\"description\": {nested}, \"description\":"),
            1,
        )
    };
    assert_eq!(problems(&hidden(11)), one("duplicateKey", "/description"));
    assert_eq!(problems(&hidden(12)), one("tooDeep", ""));
    assert_eq!(problems(&hidden(60_000)), one("tooDeep", ""));
    let padded = |bytes: usize| format!("{text}{}", " ".repeat(bytes - text.len()));
    assert_eq!(problems(&padded(128 * 1024)), Vec::new());
    assert_eq!(problems(&padded(128 * 1024 + 1)), one("tooLarge", ""));
}

#[test]
fn refuses_malformed_text_without_panicking() {
    for broken in [
        "[".repeat(100_000),
        "{\"a\": \"\\".to_string(),
        format!("{{\"a\": \"\\\"{}", "[".repeat(30)),
        format!("{}{}", "]".repeat(50), "[".repeat(5)),
        String::new(),
        "{\"a\": 1,}".to_string(),
        "{\"a\": 01}".to_string(),
        "{\"a\": 1} {\"b\": 2}".to_string(),
    ] {
        assert!(validate(&broken).is_err(), "{broken:.40}");
    }
    let text = fixture("quick-note.json");
    let brackets = "[{ [{ \\\" }] }]";
    let literal = text.replacen(
        "\"Started from a quick note.\"",
        &format!("\"{brackets}\""),
        1,
    );
    assert_eq!(problems(&literal), Vec::new());
}

#[test]
fn reads_strings_as_javascript_does() {
    let text = fixture("quick-note.json");
    let label = "/commands/0/steps/0/fields/0/label";
    let with_label =
        |raw: &str| text.replacen("\"label\": \"Topic\"", &format!("\"label\": \"{raw}\""), 1);
    // An unpaired surrogate survives JSON.parse and is refused as text, not as syntax.
    assert_eq!(
        problems(&with_label("Topic\\ud800")),
        one("invalidValue", label)
    );
    // A paired escape is one character and fine.
    assert_eq!(problems(&with_label("Topic \\ud83d\\ude00")), Vec::new());
    // JavaScript's trim removes U+FEFF; Rust's is_whitespace does not.
    let zero_width = char::from_u32(0xfeff).unwrap().to_string();
    assert_eq!(
        problems(&with_label(&zero_width)),
        one("invalidValue", label)
    );
    // A byte order mark before the package is not JSON.
    assert_eq!(
        problems(&format!("{zero_width}{text}")),
        one("invalidJson", "")
    );
    // Integer-like unknown keys are reported first, as Object.keys orders them.
    let keys = text.replacen(
        "\"schema\":",
        "\"b\": 1, \"10\": 1, \"2\": 1, \"schema\":",
        1,
    );
    let order: Vec<String> = problems(&keys).into_iter().map(|(_, path)| path).collect();
    assert_eq!(order, ["/2", "/10", "/b"]);
}

#[test]
fn the_bundled_debrief_is_the_shared_fixture_under_a_reserved_id() {
    let bundled_text = include_str!("bundled/meeting-debrief.json");
    let bundled: Value = serde_json::from_str(bundled_text).unwrap();
    let mut shared: Value = serde_json::from_str(&fixture("meeting-debrief.json")).unwrap();
    shared["id"] = Value::String("leadinglight.meeting-debrief".to_string());
    assert_eq!(bundled, shared);
    let manifest = validate(bundled_text).unwrap();
    assert_eq!(
        manifest.capabilities,
        [Capability::DocumentCreate, Capability::DocumentOpen]
    );
    assert!(missing_capabilities(&manifest.capabilities).is_empty());
}

/// Adding to a page is native now. The passage and its association are host services, so on
/// native alone commentary still needs them, and with them it needs nothing.
#[test]
fn commentary_needs_only_the_desktop_host_services_beyond_native() {
    let manifest = validate(&fixture("passage-commentary.json")).unwrap();
    assert_eq!(
        missing_from(&manifest.capabilities, &NATIVE_CAPABILITIES),
        [Capability::SelectionRead, Capability::AssociationResolve]
    );
    assert!(missing_from(&manifest.capabilities, &Capability::ALL).is_empty());
    let observation = validate(&fixture("append-observation.json")).unwrap();
    assert!(missing_capabilities(&observation.capabilities).is_empty());
}

/// This E2 build performs all five capabilities: three natively and the passage and association
/// services in the qualified desktop host. The bundled commentary needs nothing more here.
#[test]
fn this_build_performs_every_capability() {
    assert_eq!(host_capabilities(), Capability::ALL);
    let commentary = validate(include_str!("bundled/passage-commentary.json")).unwrap();
    assert!(missing_capabilities(&commentary.capabilities).is_empty());
}

#[test]
fn the_bundled_commentary_is_the_shared_fixture_under_a_reserved_id() {
    let bundled_text = include_str!("bundled/passage-commentary.json");
    let bundled: Value = serde_json::from_str(bundled_text).unwrap();
    let mut shared: Value = serde_json::from_str(&fixture("passage-commentary.json")).unwrap();
    shared["id"] = Value::String("leadinglight.passage-commentary".to_string());
    assert_eq!(bundled, shared);
    let manifest = validate(bundled_text).unwrap();
    assert_eq!(manifest.capabilities, Capability::ALL);
}
