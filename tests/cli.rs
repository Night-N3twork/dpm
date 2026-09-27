use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn dpm(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_dpm"))
        .args(args)
        .output()
        .expect("run dpm")
}

fn temp_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "dpm-test-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn install_persists_a_valid_js_binary_manifest() {
    let home = temp_dir();
    let manifest = home.join("hello.json");
    fs::write(
        &manifest,
        r#"{"dusk":1,"name":"hello","kind":"js","source":"process.stdout.write('hello')"}"#,
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_dpm"))
        .env("DPM_HOME", &home)
        .args(["install", manifest.to_str().unwrap()])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(0));
    assert!(home.join("manifests/hello.json").exists());
    let _ = fs::remove_dir_all(home);
}

#[test]
fn npm_help_is_served_by_the_rust_command_core() {
    let output = dpm(&["npm", "--help"]);

    assert_eq!(output.status.code(), Some(0));
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .contains("npm commands are executed by the Rust DPM core")
    );
}

#[test]
fn npm_install_requires_explicit_host_capabilities_in_the_native_cli() {
    let output = dpm(&["npm", "install", "chalk"]);

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("requires host capabilities"));
}

#[test]
fn npm_js_engine_requires_a_configured_legacy_entrypoint() {
    let output = dpm(&["npm", "--engine", "js", "--help"]);

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("DPM_JS_ENTRY"));
}

#[test]
fn alias_persists_tokenized_target() {
    let home = temp_dir();
    let output = Command::new(env!("CARGO_BIN_EXE_dpm"))
        .env("DPM_HOME", &home)
        .args(["alias", "npm", "=", "dpm", "npm"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        fs::read_to_string(home.join("aliases.json")).unwrap(),
        "{\n  \"npm\": [\n    \"dpm\",\n    \"npm\"\n  ]\n}\n"
    );
    let _ = fs::remove_dir_all(home);
}
