//! Package validation, mirroring `src/leadinglight/extensions/extensionSchema.ts` stage for stage:
//! reading the text, then shape, then meaning. Codes, JSON Pointer paths and their order match the
//! shared corpus in `src/leadinglight/extensions/fixtures/cases.json`. Only what native admission
//! needs is kept: identity, version, name, declared capabilities and each command's capabilities.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Serialize;

use super::json::{self, Json, Text};
use super::report::{index, pointer, shown, Code, Diagnostic, Report};

pub(crate) const SCHEMA: &str = "leadinglight.extension/1";
/// Bundled packages only; an import that uses it is refused.
pub(crate) const RESERVED_PREFIX: &str = "leadinglight.";
const MAX_PACKAGE_ID_CHARS: usize = 64;
const MAX_VERSION_CHARS: usize = 20;
const MAX_NAME_BYTES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum Capability {
    #[serde(rename = "selection.read")]
    SelectionRead,
    #[serde(rename = "association.resolve")]
    AssociationResolve,
    #[serde(rename = "document.create")]
    DocumentCreate,
    #[serde(rename = "document.append")]
    DocumentAppend,
    #[serde(rename = "document.open")]
    DocumentOpen,
}

impl Capability {
    pub(crate) const ALL: [Capability; 5] = [
        Capability::SelectionRead,
        Capability::AssociationResolve,
        Capability::DocumentCreate,
        Capability::DocumentAppend,
        Capability::DocumentOpen,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Capability::SelectionRead => "selection.read",
            Capability::AssociationResolve => "association.resolve",
            Capability::DocumentCreate => "document.create",
            Capability::DocumentAppend => "document.append",
            Capability::DocumentOpen => "document.open",
        }
    }

    fn from_name(name: &str) -> Option<Capability> {
        Capability::ALL
            .into_iter()
            .find(|capability| capability.name() == name)
    }
}

/// What this host performs: form, chosen folder, exclusive create, open.
pub(crate) const HOST_CAPABILITIES: [Capability; 2] =
    [Capability::DocumentCreate, Capability::DocumentOpen];

pub(crate) fn missing_capabilities(needed: &[Capability]) -> Vec<Capability> {
    needed
        .iter()
        .copied()
        .filter(|capability| !HOST_CAPABILITIES.contains(capability))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandManifest {
    pub(crate) id: String,
    /// What this command's steps use, in canonical order.
    pub(crate) capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Manifest {
    pub(crate) id: String,
    pub(crate) version: String,
    pub(crate) name: String,
    /// Declared, in canonical order; always equal to what the commands use.
    pub(crate) capabilities: Vec<Capability>,
    pub(crate) commands: Vec<CommandManifest>,
}

/// A package id exactly as `validate` accepts it.
pub(crate) fn valid_package_id(text: &str) -> bool {
    text.len() <= MAX_PACKAGE_ID_CHARS && is_package_id(text)
}

/// Identity fields exactly as `validate` accepts them, for records kept beside the packages.
pub(crate) fn valid_identity(id: &str, version: &str, name: &str) -> bool {
    valid_package_id(id)
        && version.len() <= MAX_VERSION_CHARS
        && is_version(version)
        && name.len() <= MAX_NAME_BYTES
        && !name.chars().all(is_js_space)
        && !name.chars().any(is_forbidden)
}

/// The package, or every diagnostic of the first stage that found a problem (at most 32).
pub(crate) fn validate(text: &str) -> Result<Manifest, Vec<Diagnostic>> {
    let mut report = Report::default();
    let value = json::read(text, &mut report);
    let manifest = match &value {
        Some(value) if report.count == 0 => package_at(&mut report, value),
        _ => None,
    };
    match manifest {
        Some(manifest) if report.count == 0 => Ok(manifest),
        _ => Err(report.list),
    }
}

// --- Shape helpers --------------------------------------------------------------------------------

type Members = [(Text, Json)];

#[derive(Clone, Copy)]
struct Spec {
    required: &'static [&'static str],
    optional: &'static [&'static str],
}

const fn spec(required: &'static [&'static str], optional: &'static [&'static str]) -> Spec {
    Spec { required, optional }
}

fn own<'j>(members: &'j Members, key: &str) -> Option<&'j Json> {
    members
        .iter()
        .find(|(name, _)| name.is(key))
        .map(|(_, value)| value)
}

/// `Object.keys` order: canonical array-index keys ascending first, then the rest as written.
fn js_key_order(members: &Members) -> Vec<&Text> {
    let mut indexes: Vec<(u32, &Text)> = Vec::new();
    let mut others: Vec<&Text> = Vec::new();
    for (key, _) in members {
        match array_index(key) {
            Some(number) => indexes.push((number, key)),
            None => others.push(key),
        }
    }
    indexes.sort_by_key(|(number, _)| *number);
    indexes
        .into_iter()
        .map(|(_, key)| key)
        .chain(others)
        .collect()
}

fn array_index(key: &Text) -> Option<u32> {
    let text = &key.text;
    let canonical = key.units.is_none()
        && !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text.len() == 1 || !text.starts_with('0'));
    if !canonical {
        return None;
    }
    text.parse::<u32>()
        .ok()
        .filter(|number| *number != u32::MAX)
}

fn check_keys(report: &mut Report, members: &Members, path: &str, what: &str, allowed: Spec) {
    let names: Vec<&str> = allowed
        .required
        .iter()
        .chain(allowed.optional.iter())
        .copied()
        .collect();
    for key in js_key_order(members) {
        if !names.iter().any(|name| key.is(name)) {
            report.add(
                Code::UnknownField,
                &pointer(path, &key.text),
                format!(
                    "{what} has no field \"{}\"; its fields are {}.",
                    shown(&key.text),
                    names.join(", ")
                ),
            );
        }
    }
    for key in allowed.required {
        if own(members, key).is_none() {
            report.add(
                Code::MissingField,
                &pointer(path, key),
                format!("{what} needs \"{key}\"."),
            );
        }
    }
}

fn object_at<'j>(
    report: &mut Report,
    value: &'j Json,
    path: &str,
    what: &str,
    allowed: Spec,
) -> &'j Members {
    match value {
        Json::Object(members) => {
            check_keys(report, members, path, what, allowed);
            members
        }
        _ => {
            report.add(
                Code::WrongType,
                path,
                format!("{what} must be a JSON object."),
            );
            &[]
        }
    }
}

/// `None` is a key already reported missing.
fn list<'j>(
    report: &mut Report,
    value: Option<&'j Json>,
    path: &str,
    what: &str,
    max: usize,
    min: usize,
) -> &'j [Json] {
    let Some(value) = value else {
        return &[];
    };
    let Json::Array(items) = value else {
        report.add(
            Code::WrongType,
            path,
            format!("{what} must be a JSON array."),
        );
        return &[];
    };
    if items.len() < min {
        report.add(
            Code::InvalidValue,
            path,
            format!("{what} needs at least {min}."),
        );
        return &[];
    }
    if items.len() > max {
        report.add(
            Code::TooMany,
            path,
            format!("{what} has {}; the limit is {max}.", items.len()),
        );
        return &[];
    }
    items
}

fn one_of(
    report: &mut Report,
    value: Option<&Json>,
    path: &str,
    options: &[&'static str],
    code: Code,
    what: &str,
    hint: &str,
) -> Option<&'static str> {
    let value = value?;
    let Json::String(text) = value else {
        report.add(Code::WrongType, path, format!("{what} must be a string."));
        return None;
    };
    if let Some(found) = options.iter().find(|option| text.is(option)) {
        return Some(*found);
    }
    report.add(
        code,
        path,
        format!(
            "{what} {} is not supported; use one of {}.{hint}",
            shown(&text.text),
            options.join(", ")
        ),
    );
    None
}

fn string_at<'j>(
    report: &mut Report,
    value: Option<&'j Json>,
    path: &str,
    what: &str,
) -> Option<&'j Text> {
    match value? {
        Json::String(text) => Some(text),
        _ => {
            report.add(Code::WrongType, path, format!("{what} must be a string."));
            None
        }
    }
}

fn is_id(text: &str) -> bool {
    let mut characters = text.chars();
    matches!(characters.next(), Some('a'..='z'))
        && text.len() <= 40
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn id_at(report: &mut Report, value: Option<&Json>, path: &str, what: &str) -> String {
    let Some(text) = string_at(report, value, path, what) else {
        return String::new();
    };
    if text.units.is_some() || !is_id(&text.text) {
        report.add(
            Code::InvalidValue,
            path,
            format!("{what} must start with a lowercase letter and use only letters, digits and hyphens, at most 40."),
        );
    }
    text.text.clone()
}

fn is_package_id(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            let mut characters = part.chars();
            matches!(characters.next(), Some('a'..='z'))
                && characters.all(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
                })
        })
}

fn is_version(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 6
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
        })
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

struct Pattern {
    valid: fn(&str) -> bool,
    rule: &'static str,
    max_chars: usize,
}

fn matching(
    report: &mut Report,
    value: Option<&Json>,
    path: &str,
    what: &str,
    pattern: Pattern,
) -> String {
    let Some(text) = string_at(report, value, path, what) else {
        return String::new();
    };
    if text.units.is_some()
        || utf16_len(&text.text) > pattern.max_chars
        || !(pattern.valid)(&text.text)
    {
        report.add(Code::InvalidValue, path, format!("{what} {}", pattern.rule));
    }
    text.text.clone()
}

/// JavaScript's `trim` set: WhiteSpace and LineTerminator. Not Rust's `is_whitespace`, which
/// differs on U+0085 and U+FEFF.
fn is_js_space(character: char) -> bool {
    matches!(
        character as u32,
        0x09..=0x0d | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff
    )
}

/// Controls, line and paragraph separators, direction overrides and isolates.
fn is_forbidden(character: char) -> bool {
    matches!(
        character as u32,
        0x00..=0x1f | 0x7f..=0x9f | 0x2028 | 0x2029 | 0x202a..=0x202e | 0x2066..=0x2069
    )
}

/// One line of plain text. Labels need visible characters; a literal part may be only spaces.
fn text_at(
    report: &mut Report,
    value: Option<&Json>,
    path: &str,
    what: &str,
    max_bytes: usize,
    visible: bool,
) -> String {
    let Some(text) = string_at(report, value, path, what) else {
        return String::new();
    };
    let empty = if visible {
        text.text.chars().all(is_js_space)
    } else {
        text.text.is_empty()
    };
    if empty {
        report.add(
            Code::InvalidValue,
            path,
            format!("{what} must not be empty."),
        );
    } else if text.units.is_some() || text.text.chars().any(is_forbidden) {
        report.add(
            Code::InvalidValue,
            path,
            format!(
                "{what} must be one line of plain text, without control or direction characters."
            ),
        );
    } else if text.text.len() > max_bytes {
        report.add(
            Code::TooLong,
            path,
            format!("{what} is longer than {max_bytes} bytes."),
        );
    }
    text.text.clone()
}

/// Reports a second use of an id; `None` items were already reported.
fn unique_ids(report: &mut Report, ids: &[Option<String>], path: &str, what: &str) {
    let mut seen: HashSet<&str> = HashSet::new();
    for (position, id) in ids.iter().enumerate() {
        let Some(id) = id else {
            continue;
        };
        if !seen.insert(id.as_str()) {
            report.add(
                Code::DuplicateId,
                &pointer(&index(path, position), "id"),
                format!("{what} \"{}\" is used more than once.", shown(id)),
            );
        }
    }
}

/// Reads the discriminating key of a tagged object.
#[allow(clippy::too_many_arguments)]
fn variant_of<'j>(
    report: &mut Report,
    value: &'j Json,
    path: &str,
    key: &str,
    options: &[&'static str],
    code: Code,
    what: &str,
    hint: &str,
) -> Option<(&'j Members, &'static str)> {
    let Json::Object(members) = value else {
        report.add(
            Code::WrongType,
            path,
            format!("{what} must be a JSON object."),
        );
        return None;
    };
    let Some(tag) = own(members, key) else {
        report.add(
            Code::MissingField,
            &pointer(path, key),
            format!("{what} needs \"{key}\"."),
        );
        return None;
    };
    let tag = one_of(
        report,
        Some(tag),
        &pointer(path, key),
        options,
        code,
        &format!("{what} {key}"),
        hint,
    )?;
    Some((members, tag))
}

// --- Package parts --------------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Ref {
    step: String,
    field: String,
}

#[derive(Debug, Clone)]
enum Part {
    Literal,
    Ref(Ref),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldKind {
    Text,
    MultilineText,
    Boolean,
    Choice,
}

#[derive(Debug, Clone)]
struct FieldDef {
    kind: FieldKind,
    id: String,
    required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Heading,
    Paragraph,
    List,
}

#[derive(Debug, Clone)]
struct Block {
    kind: BlockKind,
    text: Vec<Part>,
    items: Vec<Vec<Part>>,
    if_filled: Option<Ref>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Policy {
    NewInChosenFolder,
    ChosenExistingDocument,
    AssociatedWithSource,
}

#[derive(Debug, Clone)]
enum StepKind {
    Capture,
    Form(Vec<FieldDef>),
    Destination(Policy),
    Compose {
        title: Option<Vec<Part>>,
        blocks: Vec<Block>,
    },
    Propose,
    Open,
}

#[derive(Debug, Clone)]
struct Step {
    id: String,
    /// Position in `STEP_OPERATIONS`.
    rank: usize,
    kind: StepKind,
}

#[derive(Debug, Clone)]
struct Command {
    id: String,
    steps: Vec<Step>,
}

const STEP_OPERATIONS: [&str; 6] = [
    "capturePassage",
    "collectForm",
    "resolveDestination",
    "composeDocument",
    "proposeDocument",
    "openCommittedResult",
];
const DESTINATION_POLICIES: [&str; 3] = [
    "newInChosenFolder",
    "chosenExistingDocument",
    "associatedWithSource",
];
const FIELD_KINDS: [&str; 4] = ["text", "multilineText", "boolean", "choice"];
const BLOCK_TYPES: [&str; 4] = ["heading", "paragraph", "quote", "list"];
const LIST_STYLES: [&str; 2] = ["bullet", "numbered"];
const CAPABILITY_NAMES: [&str; 5] = [
    "selection.read",
    "association.resolve",
    "document.create",
    "document.append",
    "document.open",
];
const PACKAGE_SPEC: Spec = spec(
    &[
        "schema",
        "id",
        "version",
        "name",
        "description",
        "capabilities",
        "commands",
    ],
    &[],
);

fn ref_at(report: &mut Report, value: &Json, path: &str) -> Ref {
    let members = object_at(
        report,
        value,
        path,
        "A reference",
        spec(&["step", "field"], &[]),
    );
    let step = id_at(
        report,
        own(members, "step"),
        &pointer(path, "step"),
        "A step id",
    );
    let field = id_at(
        report,
        own(members, "field"),
        &pointer(path, "field"),
        "A field id",
    );
    Ref { step, field }
}

fn text_parts(report: &mut Report, value: Option<&Json>, path: &str) -> Vec<Part> {
    let items = list(report, value, path, "Text", 12, 1);
    let mut parts = Vec::with_capacity(items.len());
    for (position, part) in items.iter().enumerate() {
        let at = index(path, position);
        match part {
            Json::String(_) => {
                text_at(report, Some(part), &at, "Literal text", 1000, false);
                parts.push(Part::Literal);
            }
            Json::Object(_) => parts.push(Part::Ref(ref_at(report, part, &at))),
            _ => {
                report.add(
                    Code::WrongType,
                    &at,
                    "A text part is either literal text or a {\"step\", \"field\"} reference.",
                );
                parts.push(Part::Literal);
            }
        }
    }
    parts
}

fn options_at(report: &mut Report, value: Option<&Json>, path: &str) {
    let items = list(report, value, path, "Options", 12, 2);
    let mut ids = Vec::with_capacity(items.len());
    for (position, item) in items.iter().enumerate() {
        let at = index(path, position);
        let members = object_at(report, item, &at, "An option", spec(&["id", "label"], &[]));
        let id = id_at(
            report,
            own(members, "id"),
            &pointer(&at, "id"),
            "An option id",
        );
        text_at(
            report,
            own(members, "label"),
            &pointer(&at, "label"),
            "An option label",
            200,
            true,
        );
        ids.push(Some(id));
    }
    unique_ids(report, &ids, path, "Option id");
}

fn field_at(report: &mut Report, value: &Json, path: &str) -> Option<FieldDef> {
    let (members, kind) = variant_of(
        report,
        value,
        path,
        "kind",
        &FIELD_KINDS,
        Code::UnsupportedValue,
        "A field",
        "",
    )?;
    let allowed = match kind {
        "choice" => spec(&["id", "kind", "label", "options"], &["required"]),
        "boolean" => spec(&["id", "kind", "label"], &[]),
        _ => spec(&["id", "kind", "label"], &["required"]),
    };
    check_keys(report, members, path, &format!("A {kind} field"), allowed);
    let id = id_at(
        report,
        own(members, "id"),
        &pointer(path, "id"),
        "A field id",
    );
    text_at(
        report,
        own(members, "label"),
        &pointer(path, "label"),
        "A field label",
        200,
        true,
    );
    if kind == "boolean" {
        return Some(FieldDef {
            kind: FieldKind::Boolean,
            id,
            required: false,
        });
    }
    let required = match own(members, "required") {
        None => false,
        Some(Json::Bool(flag)) => *flag,
        Some(_) => {
            report.add(
                Code::WrongType,
                &pointer(path, "required"),
                "\"required\" must be true or false.",
            );
            false
        }
    };
    if kind == "choice" {
        options_at(report, own(members, "options"), &pointer(path, "options"));
        return Some(FieldDef {
            kind: FieldKind::Choice,
            id,
            required,
        });
    }
    let kind = if kind == "text" {
        FieldKind::Text
    } else {
        FieldKind::MultilineText
    };
    Some(FieldDef { kind, id, required })
}

fn heading_level(report: &mut Report, value: Option<&Json>, path: &str) {
    let Some(value) = value else {
        return;
    };
    let Json::Number(token) = value else {
        report.add(Code::WrongType, path, "A heading level must be a number.");
        return;
    };
    if !matches!(token.as_str(), "2" | "3" | "4") {
        report.add(
            Code::UnsupportedValue,
            path,
            format!(
                "A heading level {} is not supported; use one of 2, 3, 4.",
                shown(token)
            ),
        );
    }
}

fn block_at(report: &mut Report, value: &Json, path: &str) -> Option<Block> {
    let hint = " The host adds the source block itself.";
    let (members, kind) = variant_of(
        report,
        value,
        path,
        "type",
        &BLOCK_TYPES,
        Code::UnsupportedValue,
        "A block",
        hint,
    )?;
    let allowed = match kind {
        "heading" => spec(&["type", "level", "text"], &["ifFilled"]),
        "list" => spec(&["type", "style", "items"], &["ifFilled"]),
        _ => spec(&["type", "text"], &["ifFilled"]),
    };
    check_keys(report, members, path, &format!("A {kind} block"), allowed);
    let if_filled = own(members, "ifFilled")
        .map(|condition| ref_at(report, condition, &pointer(path, "ifFilled")));
    let block = match kind {
        "heading" => {
            heading_level(report, own(members, "level"), &pointer(path, "level"));
            let text = text_parts(report, own(members, "text"), &pointer(path, "text"));
            Block {
                kind: BlockKind::Heading,
                text,
                items: Vec::new(),
                if_filled,
            }
        }
        "list" => {
            one_of(
                report,
                own(members, "style"),
                &pointer(path, "style"),
                &LIST_STYLES,
                Code::UnsupportedValue,
                "A list style",
                "",
            );
            let items_path = pointer(path, "items");
            let entries = list(
                report,
                own(members, "items"),
                &items_path,
                "List items",
                24,
                1,
            );
            let mut items = Vec::with_capacity(entries.len());
            for (position, item) in entries.iter().enumerate() {
                items.push(text_parts(
                    report,
                    Some(item),
                    &index(&items_path, position),
                ));
            }
            Block {
                kind: BlockKind::List,
                text: Vec::new(),
                items,
                if_filled,
            }
        }
        _ => {
            let text = text_parts(report, own(members, "text"), &pointer(path, "text"));
            Block {
                kind: BlockKind::Paragraph,
                text,
                items: Vec::new(),
                if_filled,
            }
        }
    };
    Some(block)
}

fn policy_of(name: &str) -> Policy {
    match name {
        "chosenExistingDocument" => Policy::ChosenExistingDocument,
        "associatedWithSource" => Policy::AssociatedWithSource,
        _ => Policy::NewInChosenFolder,
    }
}

fn step_at(report: &mut Report, value: &Json, path: &str) -> Option<Step> {
    let hint = " Recipes cannot run app commands, scripts, loops or network requests.";
    let (members, op) = variant_of(
        report,
        value,
        path,
        "op",
        &STEP_OPERATIONS,
        Code::UnknownOperation,
        "A step",
        hint,
    )?;
    let allowed = match op {
        "collectForm" => spec(&["id", "op", "fields"], &[]),
        "resolveDestination" => spec(&["id", "op", "policy"], &[]),
        "composeDocument" => spec(&["id", "op", "blocks"], &["title"]),
        _ => spec(&["id", "op"], &[]),
    };
    check_keys(report, members, path, &format!("A {op} step"), allowed);
    let id = id_at(
        report,
        own(members, "id"),
        &pointer(path, "id"),
        "A step id",
    );
    let rank = STEP_OPERATIONS
        .iter()
        .position(|name| *name == op)
        .unwrap_or(0);
    let kind = match op {
        "capturePassage" => StepKind::Capture,
        "collectForm" => {
            let fields_path = pointer(path, "fields");
            let entries = list(
                report,
                own(members, "fields"),
                &fields_path,
                "Fields",
                16,
                1,
            );
            let mut fields = Vec::with_capacity(entries.len());
            for (position, item) in entries.iter().enumerate() {
                fields.push(field_at(report, item, &index(&fields_path, position)));
            }
            let ids: Vec<Option<String>> = fields
                .iter()
                .map(|field| field.as_ref().map(|field| field.id.clone()))
                .collect();
            unique_ids(report, &ids, &fields_path, "Field id");
            StepKind::Form(fields.into_iter().flatten().collect())
        }
        "resolveDestination" => {
            let policy = one_of(
                report,
                own(members, "policy"),
                &pointer(path, "policy"),
                &DESTINATION_POLICIES,
                Code::UnsupportedValue,
                "A destination policy",
                "",
            );
            StepKind::Destination(policy_of(policy.unwrap_or("newInChosenFolder")))
        }
        "composeDocument" => {
            let title = own(members, "title")
                .map(|title| text_parts(report, Some(title), &pointer(path, "title")));
            let blocks_path = pointer(path, "blocks");
            let entries = list(
                report,
                own(members, "blocks"),
                &blocks_path,
                "Blocks",
                48,
                1,
            );
            let mut blocks = Vec::with_capacity(entries.len());
            for (position, item) in entries.iter().enumerate() {
                if let Some(block) = block_at(report, item, &index(&blocks_path, position)) {
                    blocks.push(block);
                }
            }
            StepKind::Compose { title, blocks }
        }
        "proposeDocument" => StepKind::Propose,
        _ => StepKind::Open,
    };
    Some(Step { id, rank, kind })
}

fn command_at(report: &mut Report, value: &Json, path: &str) -> Command {
    let before = report.count;
    let members = object_at(
        report,
        value,
        path,
        "A command",
        spec(&["id", "title", "steps"], &[]),
    );
    let id = id_at(
        report,
        own(members, "id"),
        &pointer(path, "id"),
        "A command id",
    );
    text_at(
        report,
        own(members, "title"),
        &pointer(path, "title"),
        "A command title",
        200,
        true,
    );
    let steps_path = pointer(path, "steps");
    let entries = list(report, own(members, "steps"), &steps_path, "Steps", 6, 1);
    let mut steps = Vec::with_capacity(entries.len());
    for (position, item) in entries.iter().enumerate() {
        steps.push(step_at(report, item, &index(&steps_path, position)));
    }
    let ids: Vec<Option<String>> = steps
        .iter()
        .map(|step| step.as_ref().map(|step| step.id.clone()))
        .collect();
    unique_ids(report, &ids, &steps_path, "Step id");
    let command = Command {
        id,
        steps: steps.into_iter().flatten().collect(),
    };
    if report.count == before {
        check_command(report, &command, path);
    }
    command
}

fn capabilities_at(report: &mut Report, value: Option<&Json>) -> Vec<Capability> {
    let items = list(
        report,
        value,
        "/capabilities",
        "Capabilities",
        Capability::ALL.len(),
        1,
    );
    let mut declared: Vec<Option<Capability>> = Vec::with_capacity(items.len());
    for (position, item) in items.iter().enumerate() {
        let name = one_of(
            report,
            Some(item),
            &index("/capabilities", position),
            &CAPABILITY_NAMES,
            Code::UnknownCapability,
            "A capability",
            "",
        );
        declared.push(name.and_then(Capability::from_name));
    }
    for (position, capability) in declared.iter().enumerate() {
        let Some(capability) = capability else {
            continue;
        };
        let first = declared
            .iter()
            .position(|other| *other == Some(*capability));
        if first.is_some_and(|first| first < position) {
            report.add(
                Code::DuplicateId,
                &index("/capabilities", position),
                format!("{} is listed more than once.", capability.name()),
            );
        }
    }
    declared.into_iter().flatten().collect()
}

fn package_at(report: &mut Report, value: &Json) -> Option<Manifest> {
    let Json::Object(members) = value else {
        report.add(Code::WrongType, "", "The package must be a JSON object.");
        return None;
    };
    match own(members, "schema") {
        Some(Json::String(schema)) if schema.is(SCHEMA) => {}
        None => {
            report.add(
                Code::MissingField,
                "/schema",
                format!("The package needs \"schema\": \"{SCHEMA}\"."),
            );
            return None;
        }
        Some(_) => {
            report.add(
                Code::UnsupportedSchema,
                "/schema",
                format!("This version of LeadingLight reads only \"{SCHEMA}\" packages."),
            );
            return None;
        }
    }
    check_keys(report, members, "", "The package", PACKAGE_SPEC);
    let package_id = Pattern {
        valid: is_package_id,
        rule: "must be two or more dot-separated parts of lowercase letters, digits and hyphens, such as \"local.meeting-debrief\", at most 64 characters.",
        max_chars: MAX_PACKAGE_ID_CHARS,
    };
    let id = matching(
        report,
        own(members, "id"),
        "/id",
        "The package id",
        package_id,
    );
    let version_rule = Pattern {
        valid: is_version,
        rule: "must have the form 1.0.0.",
        max_chars: MAX_VERSION_CHARS,
    };
    let version = matching(
        report,
        own(members, "version"),
        "/version",
        "The version",
        version_rule,
    );
    let name = text_at(
        report,
        own(members, "name"),
        "/name",
        "The name",
        MAX_NAME_BYTES,
        true,
    );
    text_at(
        report,
        own(members, "description"),
        "/description",
        "The description",
        1000,
        true,
    );
    let capabilities = capabilities_at(report, own(members, "capabilities"));
    let entries = list(
        report,
        own(members, "commands"),
        "/commands",
        "Commands",
        8,
        1,
    );
    let mut commands = Vec::with_capacity(entries.len());
    for (position, item) in entries.iter().enumerate() {
        commands.push(command_at(report, item, &index("/commands", position)));
    }
    let ids: Vec<Option<String>> = commands
        .iter()
        .map(|command| Some(command.id.clone()))
        .collect();
    unique_ids(report, &ids, "/commands", "Command id");
    if report.count > 0 {
        return None;
    }
    check_capabilities(report, &capabilities, &commands);
    Some(Manifest {
        id,
        version,
        name,
        capabilities: Capability::ALL
            .into_iter()
            .filter(|capability| capabilities.contains(capability))
            .collect(),
        commands: commands
            .iter()
            .map(|command| CommandManifest {
                id: command.id.clone(),
                capabilities: command_capabilities(command),
            })
            .collect(),
    })
}

// --- Meaning --------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Line,
    Lines,
    Flag,
}

#[derive(Debug, Clone, Copy)]
struct Output {
    shape: Shape,
    always: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Usage {
    Title,
    Line,
    Lines,
    Condition,
}

struct Producer<'c> {
    position: usize,
    rank: usize,
    outputs: Vec<(&'c str, Output)>,
}

fn output_of(field: &FieldDef) -> Output {
    match field.kind {
        FieldKind::Boolean => Output {
            shape: Shape::Flag,
            always: false,
        },
        FieldKind::MultilineText => Output {
            shape: Shape::Lines,
            always: field.required,
        },
        FieldKind::Text | FieldKind::Choice => Output {
            shape: Shape::Line,
            always: field.required,
        },
    }
}

fn producers_of(command: &Command) -> HashMap<&str, Producer<'_>> {
    let mut producers = HashMap::new();
    for (position, step) in command.steps.iter().enumerate() {
        let mut outputs: Vec<(&str, Output)> = Vec::new();
        match &step.kind {
            StepKind::Capture => outputs.push((
                "sourceTitle",
                Output {
                    shape: Shape::Line,
                    always: true,
                },
            )),
            StepKind::Form(fields) => {
                for field in fields {
                    outputs.push((field.id.as_str(), output_of(field)));
                }
            }
            _ => {}
        }
        producers.insert(
            step.id.as_str(),
            Producer {
                position,
                rank: step.rank,
                outputs,
            },
        );
    }
    producers
}

struct References<'c> {
    producers: HashMap<&'c str, Producer<'c>>,
    compose_position: usize,
}

impl References<'_> {
    fn check(&self, report: &mut Report, reference: &Ref, path: &str, usage: Usage) {
        let Some(producer) = self.producers.get(reference.step.as_str()) else {
            report.add(
                Code::UnboundReference,
                &pointer(path, "step"),
                format!(
                    "There is no step \"{}\" in this command.",
                    shown(&reference.step)
                ),
            );
            return;
        };
        if producer.position >= self.compose_position {
            report.add(
                Code::ForwardReference,
                &pointer(path, "step"),
                format!(
                    "Step \"{}\" is not before this one; refer only to earlier steps.",
                    shown(&reference.step)
                ),
            );
            return;
        }
        let found = producer
            .outputs
            .iter()
            .find(|(name, _)| *name == reference.field)
            .map(|(_, output)| *output);
        let Some(output) = found else {
            let names: Vec<&str> = producer.outputs.iter().map(|(name, _)| *name).collect();
            let known = if names.is_empty() {
                format!(
                    "a {} step produces no values",
                    STEP_OPERATIONS[producer.rank]
                )
            } else {
                format!("its fields are {}", names.join(", "))
            };
            report.add(
                Code::UnboundReference,
                &pointer(path, "field"),
                format!(
                    "Step \"{}\" has no field \"{}\"; {known}.",
                    shown(&reference.step),
                    shown(&reference.field)
                ),
            );
            return;
        };
        if usage == Usage::Condition {
            return;
        }
        if output.shape == Shape::Flag {
            report.add(
                Code::IncompatibleReference,
                path,
                format!(
                    "\"{}\" is a yes/no answer; use it only in ifFilled.",
                    reference.field
                ),
            );
            return;
        }
        if output.shape == Shape::Lines && usage != Usage::Lines {
            report.add(
                Code::IncompatibleReference,
                path,
                format!("\"{}\" can hold several lines; use it in a paragraph or quote, not a title, heading or list item.", reference.field),
            );
            return;
        }
        if usage == Usage::Title && !output.always {
            report.add(
                Code::IncompatibleReference,
                path,
                format!("The title may use only answers that are always filled; make \"{}\" required or leave it out of the title.", reference.field),
            );
        }
    }

    fn parts(&self, report: &mut Report, parts: &[Part], path: &str, usage: Usage) {
        for (position, part) in parts.iter().enumerate() {
            if let Part::Ref(reference) = part {
                self.check(report, reference, &index(path, position), usage);
            }
        }
    }
}

fn check_references(report: &mut Report, command: &Command, path: &str) {
    let Some(compose_position) = command
        .steps
        .iter()
        .position(|step| matches!(step.kind, StepKind::Compose { .. }))
    else {
        return;
    };
    let StepKind::Compose { title, blocks } = &command.steps[compose_position].kind else {
        return;
    };
    let references = References {
        producers: producers_of(command),
        compose_position,
    };
    let at = index(&pointer(path, "steps"), compose_position);
    if let Some(title) = title {
        references.parts(report, title, &pointer(&at, "title"), Usage::Title);
    }
    for (position, block) in blocks.iter().enumerate() {
        let block_path = index(&pointer(&at, "blocks"), position);
        if let Some(condition) = &block.if_filled {
            references.check(
                report,
                condition,
                &pointer(&block_path, "ifFilled"),
                Usage::Condition,
            );
        }
        match block.kind {
            BlockKind::List => {
                for (item_position, item) in block.items.iter().enumerate() {
                    references.parts(
                        report,
                        item,
                        &index(&pointer(&block_path, "items"), item_position),
                        Usage::Line,
                    );
                }
            }
            BlockKind::Heading => references.parts(
                report,
                &block.text,
                &pointer(&block_path, "text"),
                Usage::Line,
            ),
            BlockKind::Paragraph => references.parts(
                report,
                &block.text,
                &pointer(&block_path, "text"),
                Usage::Lines,
            ),
        }
    }
}

const REQUIRED_STEPS: [usize; 3] = [2, 3, 4];

fn check_pipeline(report: &mut Report, command: &Command, path: &str) {
    let steps_path = pointer(path, "steps");
    let mut last: Option<usize> = None;
    for (position, step) in command.steps.iter().enumerate() {
        if last.is_some_and(|last| step.rank <= last) {
            report.add(
                Code::StepOrder,
                &pointer(&index(&steps_path, position), "op"),
                format!(
                    "Steps run in the order {}, each at most once; this {} is out of place.",
                    STEP_OPERATIONS.join(", "),
                    STEP_OPERATIONS[step.rank]
                ),
            );
        }
        last = Some(last.map_or(step.rank, |last| last.max(step.rank)));
    }
    for rank in REQUIRED_STEPS {
        if !command.steps.iter().any(|step| step.rank == rank) {
            report.add(
                Code::MissingStep,
                &steps_path,
                format!(
                    "Command \"{}\" needs a {} step.",
                    command.id, STEP_OPERATIONS[rank]
                ),
            );
        }
    }
}

fn check_destination(report: &mut Report, command: &Command, path: &str) {
    let at = |position: usize| index(&pointer(path, "steps"), position);
    let destination = command
        .steps
        .iter()
        .enumerate()
        .find_map(|(position, step)| match step.kind {
            StepKind::Destination(policy) => Some((position, policy)),
            _ => None,
        });
    let compose = command
        .steps
        .iter()
        .enumerate()
        .find_map(|(position, step)| match &step.kind {
            StepKind::Compose { title, .. } => Some((position, title.is_some())),
            _ => None,
        });
    let (Some((destination_position, policy)), Some((compose_position, has_title))) =
        (destination, compose)
    else {
        return;
    };
    let captures = command
        .steps
        .iter()
        .any(|step| matches!(step.kind, StepKind::Capture));
    let policy_path = pointer(&at(destination_position), "policy");
    if policy == Policy::AssociatedWithSource && !captures {
        report.add(
            Code::MissingStep,
            &policy_path,
            "associatedWithSource needs a capturePassage step first.",
        );
    }
    if policy != Policy::AssociatedWithSource && captures {
        report.add(
            Code::NotAllowed,
            &policy_path,
            "A captured passage can only go to the note associated with its source; use associatedWithSource.",
        );
    }
    let creates = policy != Policy::ChosenExistingDocument;
    if creates && !has_title {
        report.add(
            Code::MissingField,
            &pointer(&at(compose_position), "title"),
            "A recipe that can create a note needs a title.",
        );
    }
    if !creates && has_title {
        report.add(
            Code::NotAllowed,
            &pointer(&at(compose_position), "title"),
            "Adding to an existing page uses no title; remove it.",
        );
    }
}

/// Each check runs only when the ones before it found nothing, so one mistake gives one diagnostic.
fn check_command(report: &mut Report, command: &Command, path: &str) {
    let checks: [fn(&mut Report, &Command, &str); 3] =
        [check_pipeline, check_destination, check_references];
    for check in checks {
        let before = report.count;
        check(report, command, path);
        if report.count > before {
            return;
        }
    }
}

fn writes(policy: Policy) -> &'static [Capability] {
    match policy {
        Policy::NewInChosenFolder => &[Capability::DocumentCreate],
        Policy::ChosenExistingDocument => &[Capability::DocumentAppend],
        Policy::AssociatedWithSource => &[Capability::DocumentCreate, Capability::DocumentAppend],
    }
}

fn command_capabilities(command: &Command) -> Vec<Capability> {
    let policy = command.steps.iter().find_map(|step| match step.kind {
        StepKind::Destination(policy) => Some(policy),
        _ => None,
    });
    let mut needs: BTreeSet<Capability> = BTreeSet::new();
    for step in &command.steps {
        match step.kind {
            StepKind::Capture => {
                needs.insert(Capability::SelectionRead);
            }
            StepKind::Destination(Policy::AssociatedWithSource) => {
                needs.insert(Capability::AssociationResolve);
            }
            StepKind::Propose => {
                if let Some(policy) = policy {
                    needs.extend(writes(policy).iter().copied());
                }
            }
            StepKind::Open => {
                needs.insert(Capability::DocumentOpen);
            }
            _ => {}
        }
    }
    Capability::ALL
        .into_iter()
        .filter(|capability| needs.contains(capability))
        .collect()
}

fn check_capabilities(report: &mut Report, declared: &[Capability], commands: &[Command]) {
    let used: BTreeSet<Capability> = commands.iter().flat_map(command_capabilities).collect();
    let undeclared: Vec<&str> = Capability::ALL
        .into_iter()
        .filter(|capability| used.contains(capability) && !declared.contains(capability))
        .map(Capability::name)
        .collect();
    if !undeclared.is_empty() {
        report.add(
            Code::UndeclaredCapability,
            "/capabilities",
            format!(
                "The commands use {}; add it to capabilities.",
                undeclared.join(", ")
            ),
        );
    }
    for (position, capability) in declared.iter().enumerate() {
        if !used.contains(capability) {
            report.add(
                Code::UnusedCapability,
                &index("/capabilities", position),
                format!(
                    "No command uses {}; remove it from capabilities.",
                    capability.name()
                ),
            );
        }
    }
}
