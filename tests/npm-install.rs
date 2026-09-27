use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD};
use dpm_wasm::{HostCapabilities, HttpResponse, npm_command};
use flate2::{Compression, write::GzEncoder};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::io::Write;

struct RegistryHost {
    files: RefCell<BTreeMap<String, String>>,
    packuments: BTreeMap<String, String>,
    tarballs: BTreeMap<String, Vec<u8>>,
    local_tarballs: BTreeMap<String, Vec<u8>>,
}

#[async_trait(?Send)]
impl HostCapabilities for RegistryHost {
    async fn read(&self, path: &str) -> Result<String, String> {
        self.files
            .borrow()
            .get(path)
            .cloned()
            .ok_or_else(|| "missing".to_owned())
    }
    async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
        self.files
            .borrow_mut()
            .insert(path.to_owned(), content.to_owned());
        Ok(())
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        self.files.borrow_mut().remove(path);
        Ok(())
    }
    async fn exists(&self, path: &str) -> Result<bool, String> {
        Ok(self.files.borrow().contains_key(path))
    }
    async fn mkdir(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    async fn fetch(&self, url: &str) -> Result<HttpResponse, String> {
        let name = url
            .strip_prefix("https://registry.npmjs.org/")
            .unwrap_or_default();
        let body = self.packuments.get(name).cloned().unwrap_or_default();
        Ok(HttpResponse {
            status: 200,
            status_text: "OK".to_owned(),
            headers: BTreeMap::new(),
            body,
        })
    }
    async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        self.tarballs
            .get(url)
            .cloned()
            .ok_or_else(|| format!("missing tarball: {url}"))
    }
    async fn read_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
        self.local_tarballs
            .get(path)
            .cloned()
            .ok_or_else(|| format!("missing local tarball: {path}"))
    }
    async fn read_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let prefix = format!("{}/", path.trim_end_matches('/'));
        let mut names = std::collections::BTreeSet::new();
        for file in self.local_tarballs.keys() {
            if let Some(rest) = file.strip_prefix(&prefix) {
                if let Some(name) = rest.split('/').next() {
                    names.insert(name.to_owned());
                }
            }
        }
        if names.is_empty() {
            Err(format!("missing directory: {path}"))
        } else {
            Ok(names.into_iter().collect())
        }
    }
    async fn stat(&self, path: &str) -> Result<dpm_wasm::FileType, String> {
        if path.ends_with("/symlink") {
            return Ok(dpm_wasm::FileType::Symlink);
        }
        if self.local_tarballs.contains_key(path) || self.files.borrow().contains_key(path) {
            return Ok(dpm_wasm::FileType::File);
        }
        let prefix = format!("{}/", path.trim_end_matches('/'));
        if self
            .local_tarballs
            .keys()
            .any(|file| file.starts_with(&prefix))
        {
            return Ok(dpm_wasm::FileType::Directory);
        }
        Err(format!("missing path: {path}"))
    }
    async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.files.borrow_mut().insert(
            path.to_owned(),
            String::from_utf8_lossy(content).into_owned(),
        );
        Ok(())
    }
    async fn stdout(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    async fn stderr(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

fn integrity(bytes: &[u8]) -> String {
    format!("sha512-{}", STANDARD.encode(Sha512::digest(bytes)))
}

fn tar(files: &[(&str, &str)]) -> Vec<u8> {
    tar_records(files.iter().map(|(name, contents)| {
        (
            format!("package/{name}"),
            contents.as_bytes().to_vec(),
            b'0',
        )
    }))
}

fn tar_records(records: impl IntoIterator<Item = (String, Vec<u8>, u8)>) -> Vec<u8> {
    let mut archive = Vec::new();
    for (name, contents, kind) in records {
        let mut header = [0_u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..108].copy_from_slice(b"0000644\0");
        let size = format!("{:011o}\0", contents.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[156] = kind;
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        header[148..156].fill(b' ');
        let checksum: u32 = header.iter().map(|byte| u32::from(*byte)).sum();
        let checksum = format!("{:06o}\0 ", checksum);
        header[148..156].copy_from_slice(checksum.as_bytes());
        archive.extend_from_slice(&header);
        archive.extend_from_slice(&contents);
        archive.resize((archive.len() + 511) / 512 * 512, 0);
    }
    archive.resize(archive.len() + 1024, 0);
    archive
}

fn package_host(name: &str, tarball: Vec<u8>) -> RegistryHost {
    let tarball_url = format!("https://registry.example/{name}-1.0.0.tgz");
    let packument = format!(
        r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"{name}","version":"1.0.0","dist":{{"tarball":"{tarball_url}","integrity":"{}"}}}}}}}}"#,
        integrity(&tarball)
    );
    RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([(name.to_owned(), packument)]),
        tarballs: BTreeMap::from([(tarball_url, tarball)]),
        local_tarballs: BTreeMap::new(),
    }
}

struct FailAfterBinHost {
    files: RefCell<BTreeMap<String, String>>,
    packument: String,
    tarball: Vec<u8>,
}

#[async_trait(?Send)]
impl HostCapabilities for FailAfterBinHost {
    async fn read(&self, path: &str) -> Result<String, String> {
        self.files
            .borrow()
            .get(path)
            .cloned()
            .ok_or_else(|| "missing".to_owned())
    }
    async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
        if path == "/project/package-lock.json" {
            return Err("injected metadata failure".to_owned());
        }
        self.files
            .borrow_mut()
            .insert(path.to_owned(), content.to_owned());
        Ok(())
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        self.files.borrow_mut().remove(path);
        Ok(())
    }
    async fn exists(&self, path: &str) -> Result<bool, String> {
        Ok(self.files.borrow().contains_key(path))
    }
    async fn mkdir(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    async fn fetch(&self, _: &str) -> Result<HttpResponse, String> {
        Ok(HttpResponse {
            status: 200,
            status_text: "OK".to_owned(),
            headers: BTreeMap::new(),
            body: self.packument.clone(),
        })
    }
    async fn fetch_bytes(&self, _: &str) -> Result<Vec<u8>, String> {
        Ok(self.tarball.clone())
    }
    async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.files.borrow_mut().insert(
            path.to_owned(),
            String::from_utf8_lossy(content).into_owned(),
        );
        Ok(())
    }
    async fn stdout(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    async fn stderr(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn installs_verified_tarball_contents_and_direct_dependencies() {
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([
            (
                "fixture-package".to_owned(),
                format!(
                    r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"fixture-package","version":"1.0.0","dependencies":{{"fixture-dependency":"^1.0.0"}},"dist":{{"tarball":"https://registry.example/fixture-package-1.0.0.tgz","integrity":"{}"}}}}}}}}"#,
                    integrity(&tar(&[
                        (
                            "package.json",
                            "{\"name\":\"fixture-package\",\"version\":\"1.0.0\"}"
                        ),
                        ("index.js", "module.exports = 'fixture';\n")
                    ]))
                ),
            ),
            (
                "fixture-dependency".to_owned(),
                format!(
                    r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"fixture-dependency","version":"1.0.0","dist":{{"tarball":"https://registry.example/fixture-dependency-1.0.0.tgz","integrity":"{}"}}}}}}}}"#,
                    integrity(&tar(&[
                        (
                            "package.json",
                            "{\"name\":\"fixture-dependency\",\"version\":\"1.0.0\"}"
                        ),
                        ("index.js", "module.exports = 'dependency';\n")
                    ]))
                ),
            ),
        ]),
        tarballs: BTreeMap::from([
            (
                "https://registry.example/fixture-package-1.0.0.tgz".to_owned(),
                tar(&[
                    (
                        "package.json",
                        "{\"name\":\"fixture-package\",\"version\":\"1.0.0\"}",
                    ),
                    ("index.js", "module.exports = 'fixture';\n"),
                ]),
            ),
            (
                "https://registry.example/fixture-dependency-1.0.0.tgz".to_owned(),
                tar(&[
                    (
                        "package.json",
                        "{\"name\":\"fixture-dependency\",\"version\":\"1.0.0\"}",
                    ),
                    ("index.js", "module.exports = 'dependency';\n"),
                ]),
            ),
        ]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0);
    assert!(
        host.files
            .borrow()
            .contains_key("/project/node_modules/fixture-package/index.js")
    );
    assert!(host.files.borrow().contains_key(
        "/project/node_modules/fixture-package/node_modules/fixture-dependency/index.js"
    ));
}

#[test]
fn rejects_traversal_and_control_character_bin_names() {
    for bin in ["../escape", "bad\u{7f}name"] {
        let manifest = format!(
            "{{\"name\":\"fixture-package\",\"version\":\"1.0.0\",\"bin\":{{\"{bin}\":\"bin.js\"}}}}"
        );
        let host = package_host(
            "fixture-package",
            tar(&[("package.json", &manifest), ("bin.js", "process.exit(0)\n")]),
        );
        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "fixture-package".to_owned()],
            &host,
            "/project",
        ));
        assert_eq!(result.status, 1, "{bin:?}");
        assert!(
            result.stderr.contains("invalid bin metadata"),
            "{bin:?}: {}",
            result.stderr
        );
    }
}

#[test]
fn staged_extraction_leaves_no_files_when_a_later_entry_is_unsafe() {
    for (path, kind, expected) in [
        (
            "package/../escape.js",
            b'0',
            "tarball entry has an unsafe path",
        ),
        ("package/link", b'2', "tarball links are not supported"),
    ] {
        let tarball = tar_records(vec![
            (
                "package/package.json".to_owned(),
                br#"{"name":"fixture-package","version":"1.0.0"}"#.to_vec(),
                b'0',
            ),
            ("package/index.js".to_owned(), b"safe".to_vec(), b'0'),
            (path.to_owned(), Vec::new(), kind),
        ]);
        let host = package_host("fixture-package", tarball);

        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "fixture-package".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1, "{path}");
        assert!(
            result.stderr.contains(expected),
            "{path}: {}",
            result.stderr
        );
        assert!(
            host.files
                .borrow()
                .keys()
                .all(|path| !path.contains("/node_modules/fixture-package/")),
            "{path}: {:?}",
            host.files.borrow()
        );
    }
}

#[test]
fn archive_size_and_entry_limits_are_rejected() {
    let compressed = vec![0_u8; 32 * 1024 * 1024 + 1];
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&vec![0_u8; 128 * 1024 * 1024 + 1])
        .unwrap();
    let decompressed = encoder.finish().unwrap();
    let entries = tar_records(
        std::iter::once(("package/package.json".to_owned(), b"{}".to_vec(), b'0'))
            .chain((0..10_000).map(|index| (format!("package/files/{index}"), Vec::new(), b'0'))),
    );

    for (tarball, expected) in [
        (compressed, "tarball exceeds compressed size limit"),
        (decompressed, "tarball exceeds decompressed size limit"),
        (entries, "tarball exceeds entry count limit"),
    ] {
        let host = package_host("fixture-package", tarball);
        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "fixture-package".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1, "{expected}");
        assert!(result.stderr.contains(expected), "{}", result.stderr);
    }
}

#[test]
fn cyclic_registry_dependencies_report_a_deterministic_cycle() {
    let a_tarball = tar(&[("package.json", "{}")]);
    let b_tarball = tar(&[("package.json", "{}")]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([
            (
                "a".to_owned(),
                format!(
                    r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"a","version":"1.0.0","dependencies":{{"b":"1.0.0"}},"dist":{{"tarball":"https://registry.example/a.tgz","integrity":"{}"}}}}}}}}"#,
                    integrity(&a_tarball)
                ),
            ),
            (
                "b".to_owned(),
                format!(
                    r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"b","version":"1.0.0","dependencies":{{"a":"1.0.0"}},"dist":{{"tarball":"https://registry.example/b.tgz","integrity":"{}"}}}}}}}}"#,
                    integrity(&b_tarball)
                ),
            ),
        ]),
        tarballs: BTreeMap::from([
            ("https://registry.example/a.tgz".to_owned(), a_tarball),
            ("https://registry.example/b.tgz".to_owned(), b_tarball),
        ]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "a".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert_eq!(
        result.stderr,
        "dpm npm: dependency cycle detected: a@1.0.0\n"
    );
}

#[test]
fn bin_object_with_non_string_target_is_rejected() {
    let manifest = r#"{"name":"fixture-package","version":"1.0.0","bin":{"fixture":false}}"#;
    let host = package_host("fixture-package", tar(&[("package.json", manifest)]));

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert_eq!(
        result.stderr,
        "dpm npm: invalid bin metadata for fixture-package@1.0.0\n"
    );
}

#[test]
fn generated_bin_launchers_defer_target_format_to_node() {
    let host = package_host(
        "fixture-package",
        tar(&[
            (
                "package.json",
                r#"{"name":"fixture-package","version":"1.0.0","bin":"bin/fixture.js"}"#,
            ),
            ("bin/fixture.js", "process.exit(0)\n"),
        ]),
    );

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0);
    assert_eq!(
        host.files.borrow()["/project/node_modules/.bin/fixture-package"],
        "#!/usr/bin/env node\nglobalThis.__duskBinTarget = \"/project/node_modules/fixture-package/bin/fixture.js\";\n"
    );
    assert!(!host.files.borrow().contains_key("/usr/bin/fixture-package"));
}

#[test]
fn generated_bin_launchers_accept_dot_slash_object_targets() {
    let host = package_host(
        "fixture-package",
        tar(&[
            (
                "package.json",
                r#"{"name":"fixture-package","version":"1.0.0","bin":{"fixture":"./dist/bin.js"}}"#,
            ),
            ("dist/bin.js", "process.exit(0)\n"),
        ]),
    );

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0);
    assert_eq!(
        host.files.borrow()["/project/node_modules/.bin/fixture"],
        "#!/usr/bin/env node\nglobalThis.__duskBinTarget = \"/project/node_modules/fixture-package/dist/bin.js\";\n"
    );
}

#[test]
fn metadata_failure_after_bin_creation_removes_new_package_and_launchers() {
    let tarball = tar(&[
        (
            "package.json",
            r#"{"name":"fixture-package","version":"1.0.0","bin":"bin.js"}"#,
        ),
        ("bin.js", "process.exit(0)\n"),
    ]);
    let host = FailAfterBinHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packument: format!(
            r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"fixture-package","version":"1.0.0","dist":{{"tarball":"https://registry.example/fixture-package.tgz","integrity":"{}"}}}}}}}}"#,
            integrity(&tarball),
        ),
        tarball,
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    let files = host.files.borrow();
    assert_eq!(files["/project/package.json"], "{\"name\":\"app\"}\n");
    assert!(
        files
            .keys()
            .all(|path| !path.contains("/node_modules/fixture-package/")
                && path != "/usr/bin/fixture-package"
                && path != "/project/node_modules/.bin/fixture-package"),
        "{files:?}"
    );
}

#[test]
fn legacy_hex_shasum_is_written_as_matching_sha1_sri() {
    let tarball = tar(&[(
        "package.json",
        r#"{"name":"fixture-package","version":"1.0.0"}"#,
    )]);
    let shasum = format!("{:x}", Sha1::digest(&tarball));
    let tarball_url = "https://registry.example/fixture-package.tgz";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([(
            "fixture-package".to_owned(),
            format!(
                r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"fixture-package","version":"1.0.0","dist":{{"tarball":"{tarball_url}","shasum":"{shasum}"}}}}}}}}"#
            ),
        )]),
        tarballs: BTreeMap::from([(tarball_url.to_owned(), tarball.clone())]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "fixture-package".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0);
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
    let integrity = lock
        .pointer("/packages/node_modules~1fixture-package/integrity")
        .and_then(serde_json::Value::as_str)
        .unwrap();
    assert_eq!(
        integrity,
        format!("sha1-{}", STANDARD.encode(Sha1::digest(&tarball)))
    );
}

#[test]
fn installs_a_direct_https_tarball_and_resolves_its_dependencies_from_the_registry() {
    let root_tarball = tar(&[(
        "package.json",
        r#"{"name":"direct-package","version":"1.2.3","dependencies":{"registry-child":"^1.0.0"}}"#,
    )]);
    let child_tarball = tar(&[(
        "package.json",
        r#"{"name":"registry-child","version":"1.0.0"}"#,
    )]);
    let url = "https://packages.example/direct-package-1.2.3.tgz";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([(
            "registry-child".to_owned(),
            format!(
                r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"registry-child","version":"1.0.0","dist":{{"tarball":"https://registry.example/registry-child.tgz","integrity":"{}"}}}}}}}}"#,
                integrity(&child_tarball)
            ),
        )]),
        tarballs: BTreeMap::from([
            (url.to_owned(), root_tarball.clone()),
            (
                "https://registry.example/registry-child.tgz".to_owned(),
                child_tarball,
            ),
        ]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), url.to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        host.files
            .borrow()
            .contains_key("/project/node_modules/direct-package/package.json")
    );
    assert!(host.files.borrow().contains_key(
        "/project/node_modules/direct-package/node_modules/registry-child/package.json"
    ));
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
    assert_eq!(
        lock.pointer("/packages/node_modules~1direct-package/resolved")
            .and_then(serde_json::Value::as_str),
        Some(url)
    );
    assert_eq!(
        lock.pointer("/packages/node_modules~1direct-package/integrity")
            .and_then(serde_json::Value::as_str),
        Some(integrity(&root_tarball).as_str())
    );
}

#[test]
fn installs_an_immutable_github_git_source_as_a_cached_archive() {
    let commit = "0123456789abcdef0123456789abcdef01234567";
    let source = format!("git+https://github.com/example/archive-package.git#{commit}");
    let archive = format!("https://github.com/example/archive-package/archive/{commit}.tar.gz");
    let canonical = format!("git+https://github.com/example/archive-package.git#{commit}");
    let tarball = tar_records(vec![
        (
            format!("archive-package-{commit}/package.json"),
            br#"{"name":"archive-package","version":"1.2.3"}"#.to_vec(),
            b'0',
        ),
        (
            format!("archive-package-{commit}/index.js"),
            b"module.exports = 'archive';\n".to_vec(),
            b'0',
        ),
    ]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::new(),
        tarballs: BTreeMap::from([(archive, tarball.clone())]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), source.clone()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        host.files.borrow()["/project/node_modules/archive-package/index.js"],
        "module.exports = 'archive';\n"
    );
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
    assert_eq!(
        lock.pointer("/packages/node_modules~1archive-package/resolved")
            .and_then(serde_json::Value::as_str),
        Some(canonical.as_str())
    );
    let integrity = lock
        .pointer("/packages/node_modules~1archive-package/integrity")
        .and_then(serde_json::Value::as_str)
        .unwrap();
    assert!(integrity.starts_with("sha512-"));
    assert!(host.files.borrow().keys().any(|path| path.starts_with("/project/.dpm-cache/")));
}

#[test]
fn installs_a_cwd_relative_file_tarball_with_a_normalized_lock_source() {
    let source = "/project/fixtures/local-package.tgz";
    let tarball = tar(&[(
        "package.json",
        r#"{"name":"local-package","version":"2.0.0"}"#,
    )]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/app/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::new(),
        tarballs: BTreeMap::new(),
        local_tarballs: BTreeMap::from([(source.to_owned(), tarball.clone())]),
    };

    let result = futures::executor::block_on(npm_command(
        &[
            "install".to_owned(),
            "file:../fixtures/local-package.tgz".to_owned(),
        ],
        &host,
        "/project/app",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        host.files
            .borrow()
            .contains_key("/project/app/node_modules/local-package/package.json")
    );
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/app/package-lock.json"]).unwrap();
    assert_eq!(
        lock.pointer("/packages/node_modules~1local-package/resolved")
            .and_then(serde_json::Value::as_str),
        Some("file:/project/fixtures/local-package.tgz")
    );
    assert_eq!(
        lock.pointer("/packages/node_modules~1local-package/integrity")
            .and_then(serde_json::Value::as_str),
        Some(integrity(&tarball).as_str())
    );
}

#[test]
fn missing_or_unsafe_root_tarballs_leave_project_metadata_unchanged() {
    for (request, tarball) in [
        ("file:missing.tgz", None),
        (
            "https://packages.example/unsafe.tgz",
            Some(tar_records(vec![
                (
                    "package/package.json".to_owned(),
                    br#"{"name":"unsafe","version":"1.0.0"}"#.to_vec(),
                    b'0',
                ),
                ("package/../escape".to_owned(), Vec::new(), b'0'),
            ])),
        ),
    ] {
        let host = RegistryHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                "{\"name\":\"app\"}\n".to_owned(),
            )])),
            packuments: BTreeMap::new(),
            tarballs: tarball.map_or_else(BTreeMap::new, |tarball| {
                BTreeMap::from([(request.to_owned(), tarball)])
            }),
            local_tarballs: BTreeMap::new(),
        };
        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), request.to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1, "{request}");
        assert_eq!(
            host.files.borrow()["/project/package.json"],
            "{\"name\":\"app\"}\n"
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/package-lock.json")
        );
        assert!(
            host.files
                .borrow()
                .keys()
                .all(|path| !path.contains("/node_modules/"))
        );
    }
}

#[test]
fn installs_a_local_directory_with_binary_files_and_registry_dependencies() {
    let child_tarball = tar(&[(
        "package.json",
        r#"{"name":"registry-child","version":"1.0.0"}"#,
    )]);
    let source = "/project/fixtures/local-package";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/app/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([(
            "registry-child".to_owned(),
            format!(
                r#"{{"dist-tags":{{"latest":"1.0.0"}},"versions":{{"1.0.0":{{"name":"registry-child","version":"1.0.0","dist":{{"tarball":"https://registry.example/registry-child.tgz","integrity":"{}"}}}}}}}}"#,
                integrity(&child_tarball)
            ),
        )]),
        tarballs: BTreeMap::from([(
            "https://registry.example/registry-child.tgz".to_owned(),
            child_tarball,
        )]),
        local_tarballs: BTreeMap::from([
            (
                format!("{source}/package.json"),
                br#"{"name":"local-package","version":"2.0.0","dependencies":{"registry-child":"^1.0.0"}}"#.to_vec(),
            ),
            (format!("{source}/nested/data.bin"), vec![0, 1, 2]),
            (format!("{source}/node_modules/ignored.js"), b"ignored".to_vec()),
        ]),
    };

    let result = futures::executor::block_on(npm_command(
        &[
            "install".to_owned(),
            "file:../fixtures/local-package".to_owned(),
        ],
        &host,
        "/project/app",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    let files = host.files.borrow();
    assert_eq!(
        files["/project/app/node_modules/local-package/nested/data.bin"].as_bytes(),
        &[0, 1, 2]
    );
    assert!(!files.contains_key("/project/app/node_modules/local-package/node_modules/ignored.js"));
    assert!(files.contains_key(
        "/project/app/node_modules/local-package/node_modules/registry-child/package.json"
    ));
    let manifest: serde_json::Value =
        serde_json::from_str(&files["/project/app/package.json"]).unwrap();
    assert_eq!(
        manifest
            .pointer("/dependencies/local-package")
            .and_then(serde_json::Value::as_str),
        Some("file:../fixtures/local-package")
    );
    let lock: serde_json::Value =
        serde_json::from_str(&files["/project/app/package-lock.json"]).unwrap();
    let entry = lock
        .pointer("/packages/node_modules~1local-package")
        .unwrap();
    assert_eq!(
        entry.get("resolved").and_then(serde_json::Value::as_str),
        Some("file:/project/fixtures/local-package")
    );
    assert!(
        entry
            .get("integrity")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| value.starts_with("sha512-"))
    );
}

#[test]
fn rejects_symlinks_in_local_directories_before_installing() {
    let source = "/project/fixtures/local-package";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/app/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::new(),
        tarballs: BTreeMap::new(),
        local_tarballs: BTreeMap::from([
            (
                format!("{source}/package.json"),
                br#"{"name":"local-package","version":"2.0.0"}"#.to_vec(),
            ),
            (format!("{source}/symlink"), Vec::new()),
        ]),
    };

    let result = futures::executor::block_on(npm_command(
        &[
            "install".to_owned(),
            "file:../fixtures/local-package".to_owned(),
        ],
        &host,
        "/project/app",
    ));

    assert_eq!(result.status, 1);
    assert!(
        result
            .stderr
            .contains("local directory links are not supported")
    );
    assert!(
        host.files
            .borrow()
            .keys()
            .all(|path| !path.contains("/node_modules/"))
    );
}

#[test]
fn installs_workspace_star_from_literal_directory() {
    let source = "/project/packages/local-package";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            r#"{"name":"app","workspaces":["packages/local-package"]}"#.to_owned(),
        )])),
        packuments: BTreeMap::new(),
        tarballs: BTreeMap::new(),
        local_tarballs: BTreeMap::from([
            (
                format!("{source}/package.json"),
                br#"{"name":"local-package","version":"2.0.0"}"#.to_vec(),
            ),
            (
                format!("{source}/index.js"),
                b"module.exports = 'local';\n".to_vec(),
            ),
        ]),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "local-package@workspace:*".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        host.files
            .borrow()
            .contains_key("/project/node_modules/local-package/index.js")
    );
    let manifest: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package.json"]).unwrap();
    assert_eq!(
        manifest
            .pointer("/dependencies/local-package")
            .and_then(serde_json::Value::as_str),
        Some("workspace:*")
    );
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
    let entry = lock
        .pointer("/packages/node_modules~1local-package")
        .unwrap();
    assert_eq!(
        entry.get("resolved").and_then(serde_json::Value::as_str),
        Some("workspace:/project/packages/local-package")
    );
    assert!(
        entry
            .get("integrity")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| value.starts_with("sha512-"))
    );
    assert_eq!(
        entry.get("workspace").and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_ne!(
        entry.get("link").and_then(serde_json::Value::as_bool),
        Some(true)
    );
}

#[test]
fn rejects_missing_ambiguous_and_symlinked_workspace_packages() {
    let cases = [
        (
            r#"{"name":"app","workspaces":["packages/missing"]}"#,
            BTreeMap::new(),
            "missing path",
        ),
        (
            r#"{"name":"app","workspaces":["packages/*"]}"#,
            BTreeMap::from([
                (
                    "/project/packages/one/package.json".to_owned(),
                    br#"{"name":"local-package","version":"1.0.0"}"#.to_vec(),
                ),
                (
                    "/project/packages/two/package.json".to_owned(),
                    br#"{"name":"local-package","version":"2.0.0"}"#.to_vec(),
                ),
            ]),
            "workspace package is ambiguous",
        ),
        (
            r#"{"name":"app","workspaces":["packages/*"]}"#,
            BTreeMap::from([(
                "/project/packages/symlink/package.json".to_owned(),
                br#"{"name":"local-package","version":"1.0.0"}"#.to_vec(),
            )]),
            "workspace package is a symbolic link",
        ),
    ];
    for (manifest, local_tarballs, error) in cases {
        let host = RegistryHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                manifest.to_owned(),
            )])),
            packuments: BTreeMap::new(),
            tarballs: BTreeMap::new(),
            local_tarballs,
        };
        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "local-package@workspace:^".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1, "{error}: {}", result.stderr);
        assert!(result.stderr.contains(error), "{}", result.stderr);
        assert_eq!(host.files.borrow()["/project/package.json"], manifest);
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/package-lock.json")
        );
        assert!(
            host.files
                .borrow()
                .keys()
                .all(|path| !path.contains("/node_modules/"))
        );
    }
}

fn registry_package(name: &str, version: &str, manifest: &str) -> (String, String) {
    (
        name.to_owned(),
        format!(
            r#"{{"dist-tags":{{"latest":"{version}"}},"versions":{{"{version}":{manifest}}}}}"#
        ),
    )
}

#[test]
fn installs_all_requested_registry_packages_in_one_command() {
    let alpha_tarball = tar(&[("package.json", r#"{"name":"alpha","version":"1.0.0"}"#)]);
    let beta_tarball = tar(&[("package.json", r#"{"name":"beta","version":"2.0.0"}"#)]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([
            registry_package("alpha", "1.0.0", &format!(r#"{{"name":"alpha","version":"1.0.0","dist":{{"tarball":"https://registry.example/alpha.tgz","integrity":"{}"}}}}"#, integrity(&alpha_tarball))),
            registry_package("beta", "2.0.0", &format!(r#"{{"name":"beta","version":"2.0.0","dist":{{"tarball":"https://registry.example/beta.tgz","integrity":"{}"}}}}"#, integrity(&beta_tarball))),
        ]),
        tarballs: BTreeMap::from([
            ("https://registry.example/alpha.tgz".to_owned(), alpha_tarball),
            ("https://registry.example/beta.tgz".to_owned(), beta_tarball),
        ]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "alpha".to_owned(), "beta".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    let files = host.files.borrow();
    let manifest: Value = serde_json::from_str(&files["/project/package.json"]).unwrap();
    let lock: Value = serde_json::from_str(&files["/project/package-lock.json"]).unwrap();
    assert_eq!(manifest.pointer("/dependencies/alpha").and_then(Value::as_str), Some("^1.0.0"));
    assert_eq!(manifest.pointer("/dependencies/beta").and_then(Value::as_str), Some("^2.0.0"));
    assert!(files.contains_key("/project/node_modules/alpha/package.json"));
    assert!(files.contains_key("/project/node_modules/beta/package.json"));
    assert!(lock.pointer("/packages/node_modules~1alpha").is_some());
    assert!(lock.pointer("/packages/node_modules~1beta").is_some());
}

#[test]
fn rolls_back_every_requested_package_when_a_later_package_fails() {
    let alpha_tarball = tar(&[("package.json", r#"{"name":"alpha","version":"1.0.0"}"#)]);
    let original_manifest = "{\"name\":\"app\"}\n";
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            original_manifest.to_owned(),
        )])),
        packuments: BTreeMap::from([registry_package("alpha", "1.0.0", &format!(r#"{{"name":"alpha","version":"1.0.0","dist":{{"tarball":"https://registry.example/alpha.tgz","integrity":"{}"}}}}"#, integrity(&alpha_tarball)))]),
        tarballs: BTreeMap::from([("https://registry.example/alpha.tgz".to_owned(), alpha_tarball)]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "alpha".to_owned(), "missing".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert!(result.stderr.contains("empty packument for missing"), "{}", result.stderr);
    let files = host.files.borrow();
    assert_eq!(files["/project/package.json"], original_manifest);
    assert!(!files.contains_key("/project/package-lock.json"));
    assert!(files.keys().all(|path| !path.starts_with("/project/node_modules/")));
}

#[test]
fn reports_an_empty_successful_packument_with_request_diagnostics() {
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::new(),
        tarballs: BTreeMap::new(),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "missing".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert_eq!(
        result.stderr,
        "dpm npm: empty packument for missing: url=https://registry.npmjs.org/missing status=200 body_length=0\n"
    );
}

#[test]
fn distinguishes_a_malformed_non_empty_packument_from_an_empty_response() {
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([("broken".to_owned(), "not json".to_owned())]),
        tarballs: BTreeMap::new(),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "broken".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert!(result.stderr.contains("invalid packument for broken"));
    assert!(!result.stderr.contains("empty packument"));
}

#[test]
fn installs_a_missing_required_peer_at_the_project_root() {
    let dependent_tarball = tar(&[(
        "package.json",
        r#"{"name":"dependent","version":"1.0.0","dependencies":{"ordinary":"1.0.0"},"peerDependencies":{"peer":"^2.0.0"},"peerDependenciesMeta":{"peer":{"optional":false}}}"#,
    )]);
    let ordinary_tarball = tar(&[("package.json", r#"{"name":"ordinary","version":"1.0.0"}"#)]);
    let peer_tarball = tar(&[("package.json", r#"{"name":"peer","version":"2.1.0"}"#)]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([
            registry_package(
                "dependent",
                "1.0.0",
                &format!(
                    r#"{{"name":"dependent","version":"1.0.0","dependencies":{{"ordinary":"1.0.0"}},"peerDependencies":{{"peer":"^2.0.0"}},"peerDependenciesMeta":{{"peer":{{"optional":false}}}},"dist":{{"tarball":"https://registry.example/dependent.tgz","integrity":"{}"}}}}"#,
                    integrity(&dependent_tarball)
                ),
            ),
            registry_package(
                "ordinary",
                "1.0.0",
                &format!(
                    r#"{{"name":"ordinary","version":"1.0.0","dist":{{"tarball":"https://registry.example/ordinary.tgz","integrity":"{}"}}}}"#,
                    integrity(&ordinary_tarball)
                ),
            ),
            registry_package(
                "peer",
                "2.1.0",
                &format!(
                    r#"{{"name":"peer","version":"2.1.0","dist":{{"tarball":"https://registry.example/peer.tgz","integrity":"{}"}}}}"#,
                    integrity(&peer_tarball)
                ),
            ),
        ]),
        tarballs: BTreeMap::from([
            (
                "https://registry.example/dependent.tgz".to_owned(),
                dependent_tarball,
            ),
            (
                "https://registry.example/ordinary.tgz".to_owned(),
                ordinary_tarball,
            ),
            ("https://registry.example/peer.tgz".to_owned(), peer_tarball),
        ]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "dependent".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    let files = host.files.borrow();
    assert!(files.contains_key("/project/node_modules/peer/package.json"));
    assert!(
        files.contains_key("/project/node_modules/dependent/node_modules/ordinary/package.json")
    );
    let lock: serde_json::Value =
        serde_json::from_str(&files["/project/package-lock.json"]).unwrap();
    assert_eq!(
        lock.pointer("/packages/node_modules~1dependent/peerDependencies/peer")
            .and_then(serde_json::Value::as_str),
        Some("^2.0.0")
    );
    assert_eq!(
        lock.pointer("/packages/node_modules~1dependent/peerDependenciesMeta/peer/optional")
            .and_then(serde_json::Value::as_bool),
        Some(false)
    );
    assert_eq!(
        lock.pointer("/packages/node_modules~1peer/peer")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_ne!(
        lock.pointer("/packages/node_modules~1dependent/peer")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
}

#[test]
fn reuses_a_compatible_root_peer_without_marking_it_peer_induced() {
    let dependent_tarball = tar(&[(
        "package.json",
        r#"{"name":"dependent","version":"1.0.0","peerDependencies":{"peer":"^2.0.0"}}"#,
    )]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([
            ("/project/package.json".to_owned(), "{\"name\":\"app\"}\n".to_owned()),
            ("/project/package-lock.json".to_owned(), r#"{"lockfileVersion":3,"packages":{"node_modules/peer":{"name":"peer","version":"2.0.0"}}}"#.to_owned()),
            ("/project/node_modules/peer/package.json".to_owned(), r#"{"name":"peer","version":"2.0.0"}"#.to_owned()),
        ])),
        packuments: BTreeMap::from([registry_package("dependent", "1.0.0", &format!(r#"{{"name":"dependent","version":"1.0.0","peerDependencies":{{"peer":"^2.0.0"}},"dist":{{"tarball":"https://registry.example/dependent.tgz","integrity":"{}"}}}}"#, integrity(&dependent_tarball)))]),
        tarballs: BTreeMap::from([("https://registry.example/dependent.tgz".to_owned(), dependent_tarball)]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "dependent".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    let lock: serde_json::Value =
        serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
    assert_eq!(
        lock.pointer("/packages/node_modules~1peer/version")
            .and_then(serde_json::Value::as_str),
        Some("2.0.0")
    );
    assert_ne!(
        lock.pointer("/packages/node_modules~1peer/peer")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
}

#[test]
fn incompatible_root_peer_fails_without_writing_the_dependent() {
    let dependent_tarball = tar(&[(
        "package.json",
        r#"{"name":"dependent","version":"1.0.0","peerDependencies":{"peer":"^2.0.0"}}"#,
    )]);
    let original_manifest = "{\"name\":\"app\"}\n";
    let original_lock = r#"{"lockfileVersion":3,"packages":{"node_modules/peer":{"name":"peer","version":"1.0.0"}}}"#;
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([
            (
                "/project/package.json".to_owned(),
                original_manifest.to_owned(),
            ),
            (
                "/project/package-lock.json".to_owned(),
                original_lock.to_owned(),
            ),
            (
                "/project/node_modules/peer/package.json".to_owned(),
                r#"{"name":"peer","version":"1.0.0"}"#.to_owned(),
            ),
        ])),
        packuments: BTreeMap::from([registry_package(
            "dependent",
            "1.0.0",
            &format!(
                r#"{{"name":"dependent","version":"1.0.0","peerDependencies":{{"peer":"^2.0.0"}},"dist":{{"tarball":"https://registry.example/dependent.tgz","integrity":"{}"}}}}"#,
                integrity(&dependent_tarball)
            ),
        )]),
        tarballs: BTreeMap::from([(
            "https://registry.example/dependent.tgz".to_owned(),
            dependent_tarball,
        )]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "dependent".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 1);
    assert_eq!(
        result.stderr,
        "dpm npm: incompatible root peer peer@1.0.0 for dependent@1.0.0: requires ^2.0.0\n"
    );
    let files = host.files.borrow();
    assert_eq!(files["/project/package.json"], original_manifest);
    assert_eq!(files["/project/package-lock.json"], original_lock);
    assert!(!files.contains_key("/project/node_modules/dependent/package.json"));
}

#[test]
fn skips_an_optional_peer() {
    let dependent_tarball = tar(&[(
        "package.json",
        r#"{"name":"dependent","version":"1.0.0","peerDependencies":{"peer":"^2.0.0"},"peerDependenciesMeta":{"peer":{"optional":true}}}"#,
    )]);
    let host = RegistryHost {
        files: RefCell::new(BTreeMap::from([(
            "/project/package.json".to_owned(),
            "{\"name\":\"app\"}\n".to_owned(),
        )])),
        packuments: BTreeMap::from([registry_package(
            "dependent",
            "1.0.0",
            &format!(
                r#"{{"name":"dependent","version":"1.0.0","peerDependencies":{{"peer":"^2.0.0"}},"peerDependenciesMeta":{{"peer":{{"optional":true}}}},"dist":{{"tarball":"https://registry.example/dependent.tgz","integrity":"{}"}}}}"#,
                integrity(&dependent_tarball)
            ),
        )]),
        tarballs: BTreeMap::from([(
            "https://registry.example/dependent.tgz".to_owned(),
            dependent_tarball,
        )]),
        local_tarballs: BTreeMap::new(),
    };

    let result = futures::executor::block_on(npm_command(
        &["install".to_owned(), "dependent".to_owned()],
        &host,
        "/project",
    ));

    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        !host
            .files
            .borrow()
            .contains_key("/project/node_modules/peer/package.json")
    );
}

#[test]
fn reads_required_peers_from_local_directory_and_workspace_manifests() {
    for (request, manifest, source) in [
        (
            "file:fixtures/local-package",
            r#"{"name":"app"}"#,
            "/project/fixtures/local-package",
        ),
        (
            "local-package@workspace:*",
            r#"{"name":"app","workspaces":["packages/local-package"]}"#,
            "/project/packages/local-package",
        ),
    ] {
        let peer_tarball = tar(&[("package.json", r#"{"name":"peer","version":"2.0.0"}"#)]);
        let host = RegistryHost {
            files: RefCell::new(BTreeMap::from([("/project/package.json".to_owned(), manifest.to_owned())])),
            packuments: BTreeMap::from([registry_package("peer", "2.0.0", &format!(r#"{{"name":"peer","version":"2.0.0","dist":{{"tarball":"https://registry.example/peer.tgz","integrity":"{}"}}}}"#, integrity(&peer_tarball)))]),
            tarballs: BTreeMap::from([("https://registry.example/peer.tgz".to_owned(), peer_tarball)]),
            local_tarballs: BTreeMap::from([(
                format!("{source}/package.json"),
                br#"{"name":"local-package","version":"1.0.0","peerDependencies":{"peer":"^2.0.0"}}"#.to_vec(),
            )]),
        };

        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), request.to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 0, "{request}: {}", result.stderr);
        assert!(
            host.files
                .borrow()
                .contains_key("/project/node_modules/peer/package.json"),
            "{request}"
        );
        let lock: serde_json::Value =
            serde_json::from_str(&host.files.borrow()["/project/package-lock.json"]).unwrap();
        assert_eq!(
            lock.pointer("/packages/node_modules~1local-package/peerDependencies/peer")
                .and_then(serde_json::Value::as_str),
            Some("^2.0.0")
        );
    }
}
