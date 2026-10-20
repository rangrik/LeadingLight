//! Validation diagnostics with the same codes, JSON Pointer paths and cap as the frozen
//! TypeScript validator (`extensionContract.ts`). Messages are plain English and may differ.

use serde::Serialize;

pub(crate) const MAX_DIAGNOSTICS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Code {
    TooLarge,
    InvalidJson,
    TooDeep,
    DuplicateKey,
    InvalidNumber,
    UnknownField,
    MissingField,
    WrongType,
    InvalidValue,
    TooLong,
    TooMany,
    UnsupportedSchema,
    UnknownOperation,
    UnknownCapability,
    UnsupportedValue,
    DuplicateId,
    StepOrder,
    MissingStep,
    NotAllowed,
    UnboundReference,
    ForwardReference,
    IncompatibleReference,
    UndeclaredCapability,
    UnusedCapability,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub(crate) code: Code,
    /// JSON Pointer (RFC 6901) to the offending value or key; '' is the whole package.
    pub(crate) path: String,
    pub(crate) message: String,
}

/// Every problem is counted; only the first `MAX_DIAGNOSTICS` are kept.
#[derive(Debug, Default)]
pub(crate) struct Report {
    pub(crate) list: Vec<Diagnostic>,
    pub(crate) count: usize,
}

impl Report {
    pub(crate) fn add(&mut self, code: Code, path: &str, message: impl Into<String>) {
        self.count += 1;
        if self.list.len() < MAX_DIAGNOSTICS {
            self.list.push(Diagnostic {
                code,
                path: path.to_string(),
                message: message.into(),
            });
        }
    }

    /// Adds another report's diagnostics after this one's, in order.
    pub(crate) fn absorb(&mut self, other: Report) {
        self.count += other.count;
        for diagnostic in other.list {
            if self.list.len() < MAX_DIAGNOSTICS {
                self.list.push(diagnostic);
            }
        }
    }
}

pub(crate) fn pointer(path: &str, key: &str) -> String {
    format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"))
}

pub(crate) fn index(path: &str, position: usize) -> String {
    format!("{path}/{position}")
}

/// Package-supplied names are clipped in messages; paths stay exact.
pub(crate) fn shown(text: &str) -> String {
    if text.chars().count() > 40 {
        let clipped: String = text.chars().take(40).collect();
        format!("{clipped}…")
    } else {
        text.to_string()
    }
}
