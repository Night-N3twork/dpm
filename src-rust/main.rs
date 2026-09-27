use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use serde::Deserialize;

#[derive(Deserialize)]
struct BinaryManifest {
    dusk: u32,
    name: String,
    kind: String,
    source: Option<String>,
    capability: Option<String>,
}

fn usage() {
    println!(
        "dpm - Dusk Package Manager\n\nUsage:\n  dpm install <binary>\n  dpm npm [--engine js|rust] <npm arguments...>"
    );
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        usage();
        return ExitCode::SUCCESS;
    };

    match command.as_str() {
        "--help" | "-h" => {
            usage();
            ExitCode::SUCCESS
        }
        "install" | "i" | "add" => install(args.collect()),
        "alias" => alias(args.collect()),
        "npm" => npm(args.collect()),
        other => {
            eprintln!("dpm: unknown command '{other}'");
            ExitCode::from(2)
        }
    }
}

fn aliases_path() -> PathBuf {
    dpm_home().join("aliases.json")
}

fn read_aliases() -> Result<BTreeMap<String, Vec<String>>, String> {
    let path = aliases_path();
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&fs::read_to_string(&path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("invalid {}: {error}", path.display()))
}

fn alias(args: Vec<String>) -> ExitCode {
    if args.first().is_some_and(|arg| arg == "list") {
        if args.len() != 1 {
            eprintln!("dpm alias list: no additional arguments allowed");
            return ExitCode::from(2);
        }
        return match read_aliases() {
            Ok(aliases) => {
                for (name, target) in aliases {
                    println!("{name} = {}", target.join(" "));
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("dpm alias: {error}");
                ExitCode::from(2)
            }
        };
    }
    if args.len() < 4 || args[1] != "=" || !valid_name(&args[0]) {
        eprintln!("dpm alias: expected <name> = <target...>");
        return ExitCode::from(2);
    }
    let mut aliases = match read_aliases() {
        Ok(aliases) => aliases,
        Err(error) => {
            eprintln!("dpm alias: {error}");
            return ExitCode::from(2);
        }
    };
    aliases.insert(args[0].clone(), args[2..].to_vec());
    let path = aliases_path();
    if let Some(parent) = path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            eprintln!("dpm alias: cannot create {}: {error}", parent.display());
            return ExitCode::from(2);
        }
    }
    let contents = match serde_json::to_string_pretty(&aliases) {
        Ok(contents) => contents + "\n",
        Err(error) => {
            eprintln!("dpm alias: cannot serialize aliases: {error}");
            return ExitCode::from(2);
        }
    };
    if let Err(error) = fs::write(&path, contents) {
        eprintln!("dpm alias: cannot persist {}: {error}", path.display());
        return ExitCode::from(2);
    }
    println!("Alias {} installed", args[0]);
    ExitCode::SUCCESS
}

fn dpm_home() -> PathBuf {
    env::var_os("DPM_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".dpm")))
        .unwrap_or_else(|| PathBuf::from(".dpm"))
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

fn install(args: Vec<String>) -> ExitCode {
    if args.len() != 1 {
        eprintln!("dpm install: expected one manifest path");
        return ExitCode::from(2);
    }
    let path = Path::new(&args[0]);
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("dpm install: cannot read {}: {error}", path.display());
            return ExitCode::from(2);
        }
    };
    let manifest: BinaryManifest = match serde_json::from_str(&source) {
        Ok(manifest) => manifest,
        Err(error) => {
            eprintln!("dpm install: invalid manifest JSON: {error}");
            return ExitCode::from(2);
        }
    };
    if manifest.dusk != 1 || !valid_name(&manifest.name) {
        eprintln!("dpm install: unsupported manifest version or unsafe binary name");
        return ExitCode::from(2);
    }
    let valid_kind = match manifest.kind.as_str() {
        "js" | "shell" => manifest
            .source
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
        "host" => manifest
            .capability
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
        _ => false,
    };
    if !valid_kind {
        eprintln!("dpm install: invalid binary kind or missing required field");
        return ExitCode::from(2);
    }
    let directory = dpm_home().join("manifests");
    if let Err(error) = fs::create_dir_all(&directory) {
        eprintln!(
            "dpm install: cannot create {}: {error}",
            directory.display()
        );
        return ExitCode::from(2);
    }
    let destination = directory.join(format!("{}.json", manifest.name));
    let temporary = destination.with_extension("json.tmp");
    if let Err(error) =
        fs::write(&temporary, source).and_then(|_| fs::rename(&temporary, &destination))
    {
        let _ = fs::remove_file(&temporary);
        eprintln!(
            "dpm install: cannot persist {}: {error}",
            destination.display()
        );
        return ExitCode::from(2);
    }
    println!("Installed Dusk binary {}", manifest.name);
    ExitCode::SUCCESS
}

fn npm(mut args: Vec<String>) -> ExitCode {
    if args
        .first()
        .is_some_and(|arg| arg == "--help" || arg == "-h")
    {
        println!(
            "dpm npm - npm-compatible commands\n\nnpm commands are executed by the Rust DPM core."
        );
        return ExitCode::SUCCESS;
    }
    let mut engine = "rust".to_owned();
    if args.first().is_some_and(|arg| arg == "--engine") {
        if args.len() < 2 {
            eprintln!("dpm npm: --engine requires js or rust");
            return ExitCode::from(2);
        }
        engine = args[1].clone();
        args.drain(0..2);
    }

    match engine.as_str() {
        "rust" => {
            eprintln!("dpm npm: the native Rust command requires host capabilities");
            ExitCode::from(2)
        }
        "js" => delegate_to_js(args),
        other => {
            eprintln!("dpm npm: unknown engine '{other}'");
            ExitCode::from(2)
        }
    }
}

fn delegate_to_js(args: Vec<String>) -> ExitCode {
    let Ok(entry) = env::var("DPM_JS_ENTRY") else {
        eprintln!("dpm npm: set DPM_JS_ENTRY to the legacy JavaScript dpm entrypoint");
        return ExitCode::from(2);
    };
    let runtime = env::var("DPM_JS_RUNTIME").unwrap_or_else(|_| "node".to_owned());
    match Command::new(runtime).arg(entry).args(args).status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("dpm npm: failed to launch JavaScript backend: {error}");
            ExitCode::from(2)
        }
    }
}
