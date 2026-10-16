use super::parse_md_file;
use tempfile::TempDir;

#[derive(serde::Deserialize)]
struct TitleSourceContract {
    fixtures: Vec<TitleSourceFixture>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TitleSourceFixture {
    name: String,
    filename: String,
    content: String,
    title: String,
    title_source: String,
}

#[test]
fn parsed_title_and_source_match_shared_contract() {
    let contract: TitleSourceContract = serde_json::from_str(include_str!(
        "../../../src/shared/titleSourceContract.json"
    ))
    .expect("shared title-source contract must be valid JSON");

    for fixture in contract.fixtures {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(&fixture.filename);
        std::fs::write(&path, &fixture.content).unwrap();
        let entry = parse_md_file(&path, None).unwrap();
        assert_eq!(entry.title, fixture.title, "{}", fixture.name);
        assert_eq!(
            entry.title_source.as_deref(),
            Some(fixture.title_source.as_str()),
            "{}",
            fixture.name
        );
    }
}
