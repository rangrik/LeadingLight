// The shared corpus runs through `parse_md_file` in vault/title_source_contract_tests.rs.
use super::*;

const TITLE_CONTRACT_JSON: &str = include_str!("../../../../src/shared/titleSourceContract.json");

#[derive(serde::Deserialize)]
struct TitleContractFixture {
    name: String,
    content: String,
}

#[derive(serde::Deserialize)]
struct TitleContract {
    fixtures: Vec<TitleContractFixture>,
}

// The renderer keeps its own table; both are pinned to this one shared fixture.
#[test]
fn test_title_named_references_match_shared_fixture() {
    let contract: TitleContract = serde_json::from_str(TITLE_CONTRACT_JSON)
        .expect("shared title-source contract must be valid JSON");
    let fixture = contract
        .fixtures
        .into_iter()
        .find(|fixture| fixture.name == "literal: every supported named character reference")
        .expect("named-reference fixture must exist");
    let reference = regex::Regex::new(r"&([A-Za-z]+);").unwrap();
    let mut fixture_names: Vec<&str> = reference
        .captures_iter(&fixture.content)
        .filter_map(|captures| captures.get(1))
        .map(|name| name.as_str())
        .collect();
    let mut supported: Vec<&str> = NAMED_CHARACTER_REFERENCES
        .iter()
        .map(|(name, _)| *name)
        .collect();
    fixture_names.sort_unstable();
    supported.sort_unstable();
    assert_eq!(fixture_names, supported);
}

#[test]
fn test_title_text_removes_one_padding_space_from_code_spans() {
    assert_eq!(title_text_from_markdown("` a `|`  b  `|` `"), "a| b | ");
}

#[test]
fn test_title_text_leaves_surrounding_whitespace_for_the_caller() {
    assert_eq!(title_text_from_markdown("  \\*a\\*  "), "  *a*  ");
}

#[test]
fn test_title_text_splits_wikilink_alias_only_at_raw_or_escaped_pipe() {
    let cases = [
        ("[[a&#124;b|c]]", "c"),
        ("[[a|b&#124;c]]", "b|c"),
        ("[[a`|`b\\|c]]", "c"),
        ("[[&#124;b]]", "|b"),
    ];
    for (markdown, expected) in cases {
        assert_eq!(title_text_from_markdown(markdown), expected, "{markdown}");
    }
}

#[test]
fn test_title_text_keeps_automatic_link_underscores_literal() {
    let cases = [
        ("https://example.com/a_b\\_", "https://example.com/a_b_"),
        ("(https://example.com/_x\\_)", "(https://example.com/_x_)"),
        ("HTTPS://EXAMPLE.COM/_X_/", "HTTPS://EXAMPLE.COM/_X_/"),
        ("mail:_a_b@example.com", "mail:_a_b@example.com"),
        ("_a@b_", "a@b"),
        ("awww.x/_y_", "awww.x/y"),
    ];
    for (markdown, expected) in cases {
        assert_eq!(title_text_from_markdown(markdown), expected, "{markdown}");
    }
}

#[test]
fn test_title_text_stays_linear_on_long_input() {
    const REPEATS: usize = 40_000;
    let growing_backtick_runs = (1..=600)
        .map(|length| "`".repeat(length))
        .collect::<Vec<_>>()
        .join("a");
    let long_name = format!("{}{};", "&".repeat(REPEATS), "a".repeat(REPEATS));
    let long_url = format!("https://example.com/{}", "_a".repeat(REPEATS));
    let long_email = format!("{}@example.com", "_".repeat(REPEATS));
    let cases = [
        ("[".repeat(REPEATS * 5), "[".repeat(REPEATS * 5)),
        (
            format!("{}]]", "[[".repeat(REPEATS)),
            "[[".repeat(REPEATS - 1),
        ),
        ("[a](".repeat(REPEATS), "[a](".repeat(REPEATS)),
        (growing_backtick_runs.clone(), growing_backtick_runs),
        (long_name.clone(), long_name),
        ("~~ ".repeat(REPEATS), "~~ ".repeat(REPEATS)),
        ("_".repeat(REPEATS * 5), String::new()),
        ("\\[x\\] ".repeat(REPEATS), "[x] ".repeat(REPEATS)),
        (long_url.clone(), long_url),
        (long_email.clone(), long_email),
        ("wwwhttp:@".repeat(REPEATS), "wwwhttp:@".repeat(REPEATS)),
    ];
    for (markdown, expected) in cases {
        let actual = title_text_from_markdown(&markdown);
        assert!(actual == expected, "long input of {} bytes", markdown.len());
    }
}
