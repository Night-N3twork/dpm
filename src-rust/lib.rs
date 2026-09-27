use async_trait::async_trait;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::{Sha256, Sha512};
use std::io::Read;

#[cfg(target_arch = "wasm32")]
mod wasm;

#[derive(Serialize)]
pub struct CommandResult {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<ExecutionPlan>,
}

#[derive(Serialize)]
pub struct ExecutionPlan {
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<Vec<u8>>,
}

#[derive(Deserialize, Default)]
pub struct ExecutionContext {
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub stdin: Option<Vec<u8>>,
}

#[derive(Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    File,
    Directory,
    Symlink,
}

#[async_trait(?Send)]
pub trait HostCapabilities {
    async fn read(&self, path: &str) -> Result<String, String>;
    async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String>;
    async fn remove(&self, path: &str) -> Result<(), String>;
    async fn exists(&self, path: &str) -> Result<bool, String>;
    async fn mkdir(&self, path: &str) -> Result<(), String>;
    async fn fetch(&self, url: &str) -> Result<HttpResponse, String>;
    async fn fetch_bytes(&self, _: &str) -> Result<Vec<u8>, String> {
        Err("binary network capability is unavailable".to_owned())
    }
    async fn read_bytes(&self, _: &str) -> Result<Vec<u8>, String> {
        Err("binary filesystem capability is unavailable".to_owned())
    }
    async fn read_dir(&self, _: &str) -> Result<Vec<String>, String> {
        Err("directory filesystem capability is unavailable".to_owned())
    }
    async fn stat(&self, _: &str) -> Result<FileType, String> {
        Err("filesystem stat capability is unavailable".to_owned())
    }
    async fn atomic_write_bytes(&self, _: &str, _: &[u8]) -> Result<(), String> {
        Err("binary filesystem capability is unavailable".to_owned())
    }
    async fn stdout(&self, content: &str) -> Result<(), String>;
    async fn stderr(&self, content: &str) -> Result<(), String>;
}

fn sri_matches(bytes: &[u8], integrity: &str) -> bool {
    integrity.split_whitespace().any(|candidate| {
        let Some((algorithm, expected)) = candidate.split_once('-') else {
            return false;
        };
        let actual = match algorithm {
            "sha512" => STANDARD.encode(Sha512::digest(bytes)),
            "sha256" => STANDARD.encode(Sha256::digest(bytes)),
            "sha1" => STANDARD.encode(Sha1::digest(bytes)),
            _ => return false,
        };
        actual == expected
    })
}

fn legacy_sha1_matches(bytes: &[u8], expected: &str) -> bool {
    expected.len() == 40
        && expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        && format!("{:x}", Sha1::digest(bytes)) == expected.to_ascii_lowercase()
}

fn cache_path(cwd: &str, integrity: &str) -> String {
    format!(
        "{}/.dpm-cache/{}",
        normalized_cwd(cwd),
        URL_SAFE_NO_PAD.encode(integrity)
    )
}

async fn read_cached_tarball<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    integrity: &str,
    name: &str,
    version: &str,
) -> Result<Vec<u8>, String> {
    let path = cache_path(cwd, integrity);
    if !host.exists(&path).await? {
        return Err(format!("offline cache miss for {name}@{version}"));
    }
    let bytes = host.read_bytes(&path).await?;
    if !sri_matches(&bytes, integrity) {
        return Err(format!("cached integrity mismatch for {name}@{version}"));
    }
    Ok(bytes)
}

async fn cache_tarball<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    integrity: &str,
    bytes: &[u8],
) -> Result<(), String> {
    host.mkdir(&format!("{}/.dpm-cache", normalized_cwd(cwd)))
        .await?;
    host.atomic_write_bytes(&cache_path(cwd, integrity), bytes)
        .await
}

fn archive_path(path: &std::path::Path, expected_root: Option<&str>) -> Result<String, String> {
    use std::path::Component;
    let mut parts = path.components();
    let Some(Component::Normal(root)) = parts.next() else {
        return Err("tarball entry has an unsafe path".to_owned());
    };
    if expected_root.is_some_and(|expected| root != std::ffi::OsStr::new(expected)) {
        return Err("tarball entry is outside expected archive root".to_owned());
    }
    let mut output = Vec::new();
    for part in parts {
        match part {
            Component::Normal(part) => output.push(part.to_string_lossy().into_owned()),
            _ => return Err("tarball entry has an unsafe path".to_owned()),
        }
    }
    if output.is_empty() {
        return Err("tarball entry has no package path".to_owned());
    }
    Ok(output.join("/"))
}

struct InstallTransaction<'a, H: HostCapabilities> {
    host: &'a H,
    snapshots: Vec<MetadataSnapshot>,
}

impl<'a, H: HostCapabilities> InstallTransaction<'a, H> {
    fn new(host: &'a H) -> Self {
        Self {
            host,
            snapshots: Vec::new(),
        }
    }

    async fn snapshot(&mut self, path: &str) -> Result<(), String> {
        if self.snapshots.iter().any(|snapshot| snapshot.path == path) {
            return Ok(());
        }
        self.snapshots
            .push(snapshot(self.host, path.to_owned()).await?);
        Ok(())
    }

    async fn write(&mut self, path: &str, content: &str) -> Result<(), String> {
        self.snapshot(path).await?;
        self.host.atomic_write(path, content).await
    }

    async fn write_bytes(&mut self, path: &str, content: &[u8]) -> Result<(), String> {
        self.snapshot(path).await?;
        self.host.atomic_write_bytes(path, content).await
    }

    async fn rollback(&mut self) {
        for snapshot in self.snapshots.iter().rev() {
            match &snapshot.content {
                Some(content) => {
                    let _ = self.host.atomic_write(&snapshot.path, content).await;
                }
                None => {
                    let _ = self.host.remove(&snapshot.path).await;
                }
            }
        }
    }
}

// A command may install several roots. Keep one host-level undo log around the
// existing per-package transactions so an error in a later root restores every
// file touched by the command.
struct BatchHost<'a, H: HostCapabilities> {
    host: &'a H,
    snapshots: std::cell::RefCell<std::collections::BTreeMap<String, Option<Vec<u8>>>>,
}

impl<'a, H: HostCapabilities> BatchHost<'a, H> {
    fn new(host: &'a H) -> Self {
        Self {
            host,
            snapshots: std::cell::RefCell::new(std::collections::BTreeMap::new()),
        }
    }

    async fn snapshot(&self, path: &str) -> Result<(), String> {
        if self.snapshots.borrow().contains_key(path) {
            return Ok(());
        }
        let content = if self.host.exists(path).await? {
            match self.host.read_bytes(path).await {
                Ok(bytes) => Some(bytes),
                Err(_) => Some(self.host.read(path).await?.into_bytes()),
            }
        } else {
            None
        };
        self.snapshots.borrow_mut().insert(path.to_owned(), content);
        Ok(())
    }

    async fn rollback(&self) {
        let snapshots = std::mem::take(&mut *self.snapshots.borrow_mut());
        for (path, content) in snapshots.into_iter().rev() {
            match content {
                Some(content) => {
                    let _ = self.host.atomic_write_bytes(&path, &content).await;
                }
                None => {
                    let _ = self.host.remove(&path).await;
                }
            }
        }
    }
}

#[async_trait(?Send)]
impl<H: HostCapabilities> HostCapabilities for BatchHost<'_, H> {
    async fn read(&self, path: &str) -> Result<String, String> { self.host.read(path).await }
    async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
        self.snapshot(path).await?;
        self.host.atomic_write(path, content).await
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        self.snapshot(path).await?;
        self.host.remove(path).await
    }
    async fn exists(&self, path: &str) -> Result<bool, String> { self.host.exists(path).await }
    async fn mkdir(&self, path: &str) -> Result<(), String> { self.host.mkdir(path).await }
    async fn fetch(&self, url: &str) -> Result<HttpResponse, String> { self.host.fetch(url).await }
    async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, String> { self.host.fetch_bytes(url).await }
    async fn read_bytes(&self, path: &str) -> Result<Vec<u8>, String> { self.host.read_bytes(path).await }
    async fn read_dir(&self, path: &str) -> Result<Vec<String>, String> { self.host.read_dir(path).await }
    async fn stat(&self, path: &str) -> Result<FileType, String> { self.host.stat(path).await }
    async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.snapshot(path).await?;
        self.host.atomic_write_bytes(path, content).await
    }
    async fn stdout(&self, content: &str) -> Result<(), String> { self.host.stdout(content).await }
    async fn stderr(&self, content: &str) -> Result<(), String> { self.host.stderr(content).await }
}

struct TarballEntry {
    path: String,
    contents: Option<Vec<u8>>,
}

fn stage_tarball_with_root(bytes: &[u8], expected_root: Option<&str>) -> Result<Vec<TarballEntry>, String> {
    const MAX_COMPRESSED_BYTES: usize = 32 * 1024 * 1024;
    const MAX_DECOMPRESSED_BYTES: usize = 128 * 1024 * 1024;
    const MAX_ENTRIES: usize = 10_000;
    if bytes.len() > MAX_COMPRESSED_BYTES {
        return Err("tarball exceeds compressed size limit".to_owned());
    }
    let mut decoder = flate2::read::GzDecoder::new(bytes);
    let mut tarball = Vec::new();
    match decoder
        .by_ref()
        .take((MAX_DECOMPRESSED_BYTES + 1) as u64)
        .read_to_end(&mut tarball)
    {
        Ok(_) => {}
        Err(_) => tarball.extend_from_slice(bytes),
    }
    if tarball.len() > MAX_DECOMPRESSED_BYTES {
        return Err("tarball exceeds decompressed size limit".to_owned());
    }
    let mut archive = tar::Archive::new(tarball.as_slice());
    let mut files = Vec::new();
    let mut inferred_root: Option<String> = None;
    for (index, entry) in archive
        .entries()
        .map_err(|error| format!("invalid tarball: {error}"))?
        .enumerate()
    {
        if index >= MAX_ENTRIES {
            return Err("tarball exceeds entry count limit".to_owned());
        }
        let mut entry = entry.map_err(|error| format!("invalid tarball entry: {error}"))?;
        let entry_path = entry
            .path()
            .map_err(|error| format!("invalid tarball path: {error}"))?;
        if expected_root.is_none() {
            use std::path::Component;
            let Some(Component::Normal(root)) = entry_path.components().next() else {
                return Err("tarball entry has an unsafe path".to_owned());
            };
            let root = root.to_string_lossy().into_owned();
            if let Some(expected) = &inferred_root {
                if expected != &root {
                    return Err("git archive has multiple top-level directories".to_owned());
                }
            } else {
                inferred_root = Some(root);
            }
        }
        let path = archive_path(&entry_path, expected_root.or(inferred_root.as_deref()))?;
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err("tarball links are not supported".to_owned());
        }
        if kind.is_file() {
            let mut contents = Vec::new();
            entry
                .read_to_end(&mut contents)
                .map_err(|error| format!("cannot read tarball entry: {error}"))?;
            files.push(TarballEntry {
                path,
                contents: Some(contents),
            });
        } else if kind.is_dir() {
            files.push(TarballEntry {
                path,
                contents: None,
            });
        } else {
            return Err("tarball contains an unsupported entry type".to_owned());
        }
    }
    Ok(files)
}

fn stage_tarball(bytes: &[u8]) -> Result<Vec<TarballEntry>, String> {
    stage_tarball_with_root(bytes, Some("package"))
}

fn stage_git_archive(bytes: &[u8]) -> Result<Vec<TarballEntry>, String> {
    let files = stage_tarball_with_root(bytes, None)?;
    if files.iter().any(|entry| entry.path == ".gitmodules") {
        return Err("git archive contains submodules".to_owned());
    }
    Ok(files)
}

async fn extract_staged_tarball<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    files: &[TarballEntry],
    directory: &str,
) -> Result<(), String> {
    for entry in files {
        let destination = format!("{directory}/{}", entry.path);
        if let Some(contents) = &entry.contents {
            let mut parent = directory.to_owned();
            let mut segments = entry.path.split('/').peekable();
            while let Some(segment) = segments.next() {
                if segments.peek().is_none() {
                    break;
                }
                parent.push('/');
                parent.push_str(segment);
                transaction.host.mkdir(&parent).await?;
            }
            transaction.write_bytes(&destination, &contents).await?;
        } else {
            transaction.host.mkdir(&destination).await?;
        }
    }
    Ok(())
}

async fn extract_tarball<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    bytes: &[u8],
    directory: &str,
) -> Result<(), String> {
    let files = stage_tarball(bytes)?;
    extract_staged_tarball(transaction, &files, directory).await
}

enum RootTarballSource {
    Https(String),
    GitArchive { archive: String, resolved: String },
    File(String),
    Directory(String),
}

fn git_archive_source(request: &str) -> Result<RootTarballSource, String> {
    let Some(url) = request.strip_prefix("git+https://") else {
        return Err("git sources must use git+https with an immutable commit".to_owned());
    };
    let Some((repository, commit)) = url.split_once('#') else {
        return Err("git sources must include an immutable 40 or 64 hex commit".to_owned());
    };
    if repository.contains('#') || repository.contains('?') || commit.len() != 40 && commit.len() != 64 || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("git sources must include an immutable 40 or 64 hex commit".to_owned());
    }
    let Some((authority, path)) = repository.split_once('/') else {
        return Err("git source must include a supported HTTPS repository path".to_owned());
    };
    if authority.is_empty() || authority.contains(['@', ':']) {
        return Err("git source credentials and ports are not supported".to_owned());
    }
    let host = authority.to_ascii_lowercase();
    if host != "github.com" && host != "gitlab.com" {
        return Err("git source host is not supported".to_owned());
    }
    let path = path.strip_suffix(".git").unwrap_or(path);
    let segments: Vec<&str> = path.split('/').collect();
    if (host == "github.com" && segments.len() != 2) || (host == "gitlab.com" && segments.len() < 2) || segments.iter().any(|segment| segment.is_empty() || !segment.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))) {
        return Err("git source must name a supported HTTPS repository".to_owned());
    }
    let commit = commit.to_ascii_lowercase();
    let canonical = format!("git+https://{host}/{path}.git#{commit}");
    let archive = if host == "github.com" {
        format!("https://github.com/{path}/archive/{commit}.tar.gz")
    } else {
        format!(
            "https://gitlab.com/{path}/-/archive/{commit}/{}-{commit}.tar.gz",
            segments.last().unwrap()
        )
    };
    Ok(RootTarballSource::GitArchive { archive, resolved: canonical })
}

fn root_tarball_source(request: &str, cwd: &str) -> Result<Option<RootTarballSource>, String> {
    if request.starts_with("git+") {
        return git_archive_source(request).map(Some);
    }
    if request.starts_with("https://") {
        if !request
            .split(['?', '#'])
            .next()
            .is_some_and(|url| url.ends_with(".tgz"))
        {
            return Err("direct HTTPS sources must reference a .tgz tarball".to_owned());
        }
        return Ok(Some(RootTarballSource::Https(request.to_owned())));
    }
    let Some(path) = request.strip_prefix("file:") else {
        return Ok(None);
    };
    if path.is_empty() {
        return Err("file: source is empty".to_owned());
    }
    let absolute = if path.starts_with('/') {
        normalized_cwd(path)
    } else {
        normalized_cwd(&format!("{}/{}", normalized_cwd(cwd), path))
    };
    Ok(Some(if absolute.ends_with(".tgz") {
        RootTarballSource::File(absolute)
    } else {
        RootTarballSource::Directory(absolute)
    }))
}

struct RootTarball {
    name: String,
    version: String,
    resolved: String,
    integrity: String,
    files: Vec<TarballEntry>,
    dependencies: serde_json::Map<String, Value>,
    manifest: Value,
}

struct RootPackage {
    tarball: RootTarball,
    link: bool,
    workspace: bool,
}

async fn load_root_tarball<H: HostCapabilities>(
    host: &H,
    source: RootTarballSource,
    cwd: &str,
) -> Result<RootTarball, String> {
    let (bytes, resolved) = match source {
        RootTarballSource::Https(url) => (
            host.fetch_bytes(&url)
                .await
                .map_err(|error| format!("cannot download {url}: {error}"))?,
            url,
        ),
        RootTarballSource::GitArchive { archive, resolved } => {
            let bytes = host
                .fetch_bytes(&archive)
                .await
                .map_err(|error| format!("cannot download {archive}: {error}"))?;
            let files = stage_git_archive(&bytes)?;
            let package = root_package_from_files(files, resolved, Some(&bytes))?;
            cache_tarball(host, cwd, &package.integrity, &bytes).await?;
            return Ok(package);
        }
        RootTarballSource::File(path) => (
            host.read_bytes(&path)
                .await
                .map_err(|error| format!("cannot read file:{path}: {error}"))?,
            format!("file:{path}"),
        ),
        RootTarballSource::Directory(path) => {
            let files = stage_local_directory(host, &path).await?;
            return root_package_from_files(files, format!("file:{path}"), None);
        }
    };
    let files = stage_tarball(&bytes)?;
    let package = root_package_from_files(files, resolved, Some(&bytes))?;
    cache_tarball(host, cwd, &package.integrity, &bytes).await?;
    Ok(package)
}

fn root_package_from_files(
    files: Vec<TarballEntry>,
    resolved: String,
    source_bytes: Option<&[u8]>,
) -> Result<RootTarball, String> {
    let manifest = files
        .iter()
        .find(|entry| entry.path == "package.json")
        .and_then(|entry| entry.contents.as_deref())
        .ok_or_else(|| "tarball has no package.json".to_owned())?;
    let manifest: Value = serde_json::from_slice(manifest)
        .map_err(|error| format!("invalid tarball package.json: {error}"))?;
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| valid_package_name(name))
        .ok_or_else(|| "tarball package.json has an invalid name".to_owned())?
        .to_owned();
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| Version::parse(version).is_ok())
        .ok_or_else(|| "tarball package.json has an invalid version".to_owned())?
        .to_owned();
    let dependencies = manifest.get("dependencies").map_or_else(
        || Ok(serde_json::Map::new()),
        |dependencies| {
            dependencies
                .as_object()
                .cloned()
                .ok_or_else(|| "tarball package.json dependencies must be an object".to_owned())
        },
    )?;
    let integrity_bytes = source_bytes.map_or_else(|| directory_fingerprint(&files), Vec::from);
    Ok(RootTarball {
        name,
        version,
        resolved,
        integrity: format!(
            "sha512-{}",
            STANDARD.encode(Sha512::digest(&integrity_bytes))
        ),
        files,
        dependencies,
        manifest,
    })
}

fn safe_directory_entry(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

#[async_recursion::async_recursion(?Send)]
async fn stage_local_directory_at<H: HostCapabilities>(
    host: &H,
    source: &str,
    relative: &str,
    files: &mut Vec<TarballEntry>,
) -> Result<(), String> {
    let mut names = host.read_dir(source).await?;
    names.sort();
    for name in names {
        if !safe_directory_entry(&name) {
            return Err("local directory has an unsafe path".to_owned());
        }
        if name == "node_modules" {
            continue;
        }
        let path = format!("{source}/{name}");
        let entry_path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        match host.stat(&path).await? {
            FileType::File => files.push(TarballEntry {
                path: entry_path,
                contents: Some(host.read_bytes(&path).await?),
            }),
            FileType::Directory => {
                files.push(TarballEntry {
                    path: entry_path.clone(),
                    contents: None,
                });
                stage_local_directory_at(host, &path, &entry_path, files).await?;
            }
            FileType::Symlink => return Err("local directory links are not supported".to_owned()),
        }
    }
    Ok(())
}

async fn stage_local_directory<H: HostCapabilities>(
    host: &H,
    source: &str,
) -> Result<Vec<TarballEntry>, String> {
    match host.stat(source).await? {
        FileType::Directory => {}
        FileType::Symlink => return Err("local directory links are not supported".to_owned()),
        FileType::File => {
            return Err("file: source must reference a directory or .tgz tarball".to_owned());
        }
    }
    let mut files = Vec::new();
    stage_local_directory_at(host, source, "", &mut files).await?;
    Ok(files)
}

fn workspace_path(cwd: &str, entry: &str) -> Result<(String, bool), String> {
    if entry.is_empty() || entry.contains('\0') || entry.contains("**") {
        return Err(format!("unsupported workspace entry: {entry}"));
    }
    let (path, glob) = entry
        .strip_suffix("/*")
        .map_or((entry, false), |path| (path, true));
    if path.is_empty() || path.contains('*') {
        return Err(format!("unsupported workspace entry: {entry}"));
    }
    Ok((
        if path.starts_with('/') {
            normalized_cwd(path)
        } else {
            normalized_cwd(&format!("{}/{}", normalized_cwd(cwd), path))
        },
        glob,
    ))
}

async fn load_workspace_package<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    manifest: &Value,
    name: &str,
    selector: &str,
) -> Result<RootPackage, String> {
    if selector != "workspace:*" && selector != "workspace:^" {
        return Err(format!(
            "unsupported workspace selector for {name}: {selector}"
        ));
    }
    let entries = manifest
        .get("workspaces")
        .and_then(Value::as_array)
        .ok_or_else(|| "package.json workspaces must be an array".to_owned())?;
    let mut candidates = std::collections::BTreeSet::new();
    for entry in entries {
        let entry = entry
            .as_str()
            .ok_or_else(|| "package.json workspaces must contain strings".to_owned())?;
        let (source, glob) = workspace_path(cwd, entry)?;
        match host.stat(&source).await? {
            FileType::Symlink => {
                return Err(format!("workspace package is a symbolic link: {source}"));
            }
            FileType::File => return Err(format!("workspace entry is not a directory: {source}")),
            FileType::Directory => {}
        }
        if glob {
            for child in host.read_dir(&source).await? {
                if !safe_directory_entry(&child) {
                    return Err("workspace directory has an unsafe path".to_owned());
                }
                let child = format!("{source}/{child}");
                match host.stat(&child).await? {
                    FileType::Directory => {
                        candidates.insert(child);
                    }
                    FileType::Symlink => {
                        return Err(format!("workspace package is a symbolic link: {child}"));
                    }
                    FileType::File => {}
                }
            }
        } else {
            candidates.insert(source);
        }
    }
    let mut matches = Vec::new();
    for source in candidates {
        let files = stage_local_directory(host, &source).await?;
        let tarball = root_package_from_files(files, format!("workspace:{source}"), None)?;
        if tarball.name == name {
            matches.push(tarball);
        }
    }
    match matches.len() {
        0 => Err(format!("workspace package not found: {name}")),
        1 => Ok(RootPackage {
            tarball: matches.pop().unwrap(),
            link: false,
            workspace: true,
        }),
        _ => Err(format!("workspace package is ambiguous: {name}")),
    }
}

fn directory_fingerprint(files: &[TarballEntry]) -> Vec<u8> {
    let mut files: Vec<&TarballEntry> = files.iter().collect();
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let mut fingerprint = Vec::new();
    for entry in files {
        fingerprint.extend_from_slice(if entry.contents.is_some() {
            b"F\0"
        } else {
            b"D\0"
        });
        fingerprint.extend_from_slice(entry.path.as_bytes());
        fingerprint.push(0);
        if let Some(contents) = &entry.contents {
            fingerprint.extend_from_slice(&(contents.len() as u64).to_be_bytes());
            fingerprint.extend_from_slice(contents);
        }
    }
    fingerprint
}

fn npm_version_requirements(request: &str) -> Result<Vec<VersionReq>, ()> {
    request
        .split("||")
        .map(|clause| {
            let mut comparators = Vec::new();
            let mut tokens = clause.split_whitespace();
            while let Some(token) = tokens.next() {
                let comparator = match token {
                    ">" | ">=" | "<" | "<=" | "=" | "~" | "^" => {
                        let version = tokens.next().ok_or(())?;
                        format!("{token}{version}")
                    }
                    _ => token.to_owned(),
                };
                comparators.push(comparator);
            }
            if comparators.is_empty() {
                return Err(());
            }
            VersionReq::parse(&comparators.join(", ")).map_err(|_| ())
        })
        .collect()
}

fn selected_version(packument: &Value, requested: Option<&str>) -> Result<String, String> {
    let versions = packument
        .pointer("/versions")
        .and_then(Value::as_object)
        .ok_or_else(|| "packument has no versions".to_owned())?;
    if let Some(request) = requested {
        if versions.contains_key(request) {
            return Ok(request.to_owned());
        }
        if let Some(tag) = packument
            .pointer(&format!("/dist-tags/{request}"))
            .and_then(Value::as_str)
        {
            return Ok(tag.to_owned());
        }
        let requirements = npm_version_requirements(request)
            .map_err(|_| format!("unsupported version spec: {request}"))?;
        return versions
            .keys()
            .filter_map(|version| Version::parse(version).ok())
            .filter(|version| requirements.iter().any(|requirement| requirement.matches(version)))
            .max()
            .map(|version| version.to_string())
            .ok_or_else(|| format!("no version satisfies {request}"));
    }
    packument
        .pointer("/dist-tags/latest")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "packument has no latest dist-tag".to_owned())
}

const DPM_REGISTRY: &str = "https://registry.dusk.night-x.com/";
const NPM_REGISTRY: &str = "https://registry.npmjs.org/";

fn registry_base(value: &str) -> Result<&str, String> {
    if !value.starts_with("https://") || !value.ends_with('/') || value.contains(['?', '#']) {
        return Err("registry must be an HTTPS base URL ending in /".to_owned());
    }
    let authority = &value["https://".len()..value.len() - 1];
    if authority.is_empty() || authority.starts_with('/') || authority.contains("//") {
        return Err("registry must be an HTTPS base URL ending in /".to_owned());
    }
    Ok(value)
}

fn registry_package_path(name: &str) -> String {
    name.replace('@', "%40").replace('/', "%2F")
}

fn resolve_tarball_url(registry: &str, tarball: &str) -> String {
    if tarball.starts_with("https://") || tarball.starts_with("http://") {
        return tarball.to_owned();
    }
    format!("{}{}", registry, tarball.trim_start_matches('/'))
}

async fn resolve_registry_package<H: HostCapabilities>(
    host: &H,
    registry: &str,
    fallback_registry: Option<&str>,
    name: &str,
    requested: Option<&str>,
) -> Result<(String, Value), String> {
    let url = format!("{registry}{}", registry_package_path(name));
    let response = host.fetch(&url).await?;
    if response.status == 404 {
        if let Some(fallback_registry) = fallback_registry {
            let fallback_url = format!("{fallback_registry}{}", registry_package_path(name));
            let fallback_response = host.fetch(&fallback_url).await?;
            return resolve_packument_response(fallback_registry, &fallback_url, fallback_response, name, requested);
        }
    }
    resolve_packument_response(registry, &url, response, name, requested)
}

fn resolve_packument_response(
    registry: &str,
    url: &str,
    response: HttpResponse,
    name: &str,
    requested: Option<&str>,
) -> Result<(String, Value), String> {
    if !(200..300).contains(&response.status) {
        return Err(format!(
            "registry returned {} {} for {name}",
            response.status, response.status_text
        ));
    }
    if response.body.is_empty() {
        return Err(format!(
            "empty packument for {name}: url={url} status={} body_length={}",
            response.status,
            response.body.len()
        ));
    }
    let packument: Value = serde_json::from_str(&response.body)
        .map_err(|error| format!("invalid packument for {name}: {error}"))?;
    let version = selected_version(&packument, requested)?;
    let mut package = packument
        .pointer(&format!("/versions/{version}"))
        .cloned()
        .ok_or_else(|| format!("{name}@{version} is not available"))?;
    if let Some(tarball) = package
        .pointer("/dist/tarball")
        .and_then(Value::as_str)
        .map(str::to_owned)
    {
        if let Some(dist) = package.get_mut("dist").and_then(Value::as_object_mut) {
            dist.insert(
                "tarball".to_owned(),
                Value::String(resolve_tarball_url(registry, &tarball)),
            );
        }
    }
    Ok((version, package))
}

fn lock_entry(
    name: &str,
    version: &str,
    tarball: &str,
    integrity: Value,
    package: &Value,
) -> Value {
    let mut entry =
        json!({ "name": name, "version": version, "resolved": tarball, "integrity": integrity });
    for field in ["peerDependencies", "peerDependenciesMeta"] {
        if let Some(value) = package.get(field) {
            entry[field] = value.clone();
        }
    }
    entry
}

async fn root_peer_version<H: HostCapabilities>(
    host: &H,
    project_dir: &str,
    name: &str,
    lock: &Value,
) -> Result<Option<String>, String> {
    let manifest_path = format!("{project_dir}/node_modules/{name}/package.json");
    if host.exists(&manifest_path).await? {
        let manifest: Value = serde_json::from_str(&host.read(&manifest_path).await?)
            .map_err(|error| format!("invalid root peer manifest for {name}: {error}"))?;
        return Ok(manifest
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_owned));
    }
    Ok(lock["packages"]
        .get(format!("node_modules/{name}"))
        .and_then(|entry| entry.get("version"))
        .and_then(Value::as_str)
        .map(str::to_owned))
}

#[async_recursion::async_recursion(?Send)]
async fn install_required_peers<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    project_dir: &str,
    registry: &str,
    fallback_registry: Option<&str>,
    package: &Value,
    lock: &mut Value,
    active: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    let Some(peers) = package.get("peerDependencies") else {
        return Ok(());
    };
    let peers = peers
        .as_object()
        .ok_or_else(|| "peerDependencies must be an object".to_owned())?;
    let metadata = package
        .get("peerDependenciesMeta")
        .map_or(Ok(None), |metadata| {
            metadata
                .as_object()
                .map(Some)
                .ok_or_else(|| "peerDependenciesMeta must be an object".to_owned())
        })?;
    let package_name = package
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("package");
    let package_version = package
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    for (name, range) in peers {
        if !valid_package_name(name) {
            return Err(format!("invalid peer dependency name: {name}"));
        }
        let range = range
            .as_str()
            .ok_or_else(|| format!("invalid peer dependency spec for {name}"))?;
        let requirements = npm_version_requirements(range)
            .map_err(|_| format!("unsupported peer dependency spec for {name}: {range}"))?;
        if metadata
            .and_then(|metadata| metadata.get(name))
            .is_some_and(|metadata| metadata.get("optional").and_then(Value::as_bool) == Some(true))
        {
            continue;
        }
        if let Some(version) = root_peer_version(transaction.host, project_dir, name, lock).await? {
            let version = Version::parse(&version)
                .map_err(|_| format!("invalid root peer version for {name}: {version}"))?;
            if !requirements.iter().any(|requirement| requirement.matches(&version)) {
                return Err(format!(
                    "incompatible root peer {name}@{version} for {package_name}@{package_version}: requires {range}"
                ));
            }
            continue;
        }
        let directory = format!("{project_dir}/node_modules/{name}");
        install_package_inner(
            transaction,
            project_dir,
            registry,
            fallback_registry,
            name,
            Some(range),
            &directory,
            lock,
            active,
        )
        .await?;
        lock["packages"][format!("node_modules/{name}")]["peer"] = json!(true);
    }
    Ok(())
}

#[async_recursion::async_recursion(?Send)]
async fn install_package<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    project_dir: &str,
    registry: &str,
    fallback_registry: Option<&str>,
    name: &str,
    requested: Option<&str>,
    directory: &str,
    lock: &mut Value,
) -> Result<(), String> {
    let mut active = std::collections::BTreeSet::new();
    install_package_inner(
        transaction,
        project_dir,
        registry,
        fallback_registry,
        name,
        requested,
        directory,
        lock,
        &mut active,
    )
    .await
}

#[async_recursion::async_recursion(?Send)]
async fn install_package_inner<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    project_dir: &str,
    registry: &str,
    fallback_registry: Option<&str>,
    name: &str,
    requested: Option<&str>,
    directory: &str,
    lock: &mut Value,
    active: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    let (version, package) =
        resolve_registry_package(transaction.host, registry, fallback_registry, name, requested).await?;
    let identity = format!("{name}@{version}");
    if !active.insert(identity.clone()) {
        return Err(format!("dependency cycle detected: {identity}"));
    }
    let root_directory = format!("{project_dir}/node_modules/{name}");
    let directory = if directory == root_directory {
        directory.to_owned()
    } else {
        let root_lock_path = format!("node_modules/{name}");
        let root_version = lock["packages"]
            .get(&root_lock_path)
            .and_then(|entry| entry.get("version"))
            .and_then(Value::as_str);
        let compatible = root_version.is_some_and(|root_version| {
            root_version == version
                || requested
                    .and_then(|range| npm_version_requirements(range).ok())
                    .and_then(|requirements| {
                        Version::parse(root_version)
                            .ok()
                            .map(|root_version| requirements.iter().any(|requirement| requirement.matches(&root_version)))
                    })
                    .unwrap_or(false)
        });
        if compatible {
            active.remove(&identity);
            return Ok(());
        }
        directory.to_owned()
    };
    let dist = package
        .pointer("/dist")
        .ok_or_else(|| format!("{name}@{version} has no dist metadata"))?;
    let tarball = dist
        .pointer("/tarball")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{name}@{version} has no tarball"))?;
    let bytes = transaction
        .host
        .fetch_bytes(tarball)
        .await
        .map_err(|error| format!("cannot download {name}@{version}: {error}"))?;
    if let Some(integrity) = dist.pointer("/integrity").and_then(Value::as_str) {
        if !sri_matches(&bytes, integrity) {
            return Err(format!("integrity mismatch for {name}@{version}"));
        }
    } else if let Some(shasum) = dist.pointer("/shasum").and_then(Value::as_str) {
        if !legacy_sha1_matches(&bytes, shasum) {
            return Err(format!("integrity mismatch for {name}@{version}"));
        }
    } else {
        return Err(format!(
            "registry did not provide integrity for {name}@{version}"
        ));
    }
    let cache_integrity = dist
        .get("integrity")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("sha1-{}", STANDARD.encode(Sha1::digest(&bytes))));
    cache_tarball(transaction.host, project_dir, &cache_integrity, &bytes).await?;
    transaction.host.mkdir(&directory).await?;
    extract_tarball(transaction, &bytes, &directory).await?;
    let lock_path = directory
        .find("/node_modules/")
        .map(|index| &directory[index + 1..])
        .unwrap_or_else(|| directory.strip_prefix('/').unwrap_or(&directory));
    let integrity = dist
        .get("integrity")
        .cloned()
        .unwrap_or_else(|| Value::String(cache_integrity));
    lock["packages"][lock_path] = lock_entry(name, &version, tarball, integrity, &package);
    install_required_peers(transaction, project_dir, registry, fallback_registry, &package, lock, active).await?;
    if let Some(dependencies) = package.pointer("/dependencies").and_then(Value::as_object) {
        for (dependency, range) in dependencies {
            if !valid_package_name(dependency) {
                return Err(format!("invalid dependency name: {dependency}"));
            }
            let range = range
                .as_str()
                .ok_or_else(|| format!("invalid dependency spec for {dependency}"))?;
            if range.starts_with("git+")
                || range.starts_with("file:")
                || range.starts_with("workspace:")
                || range.contains('/')
            {
                return Err(format!(
                    "unsupported dependency spec for {dependency}: {range}"
                ));
            }
            install_package_inner(
                transaction,
                project_dir,
                registry,
                fallback_registry,
                dependency,
                Some(range),
                &format!("{directory}/node_modules/{dependency}"),
                lock,
                active,
            )
            .await?;
        }
    }
    active.remove(&identity);
    Ok(())
}

fn failure(message: impl Into<String>) -> CommandResult {
    CommandResult {
        status: 1,
        stdout: String::new(),
        stderr: format!("dpm npm: {}\n", message.into()),
        plan: None,
    }
}

#[derive(Deserialize, Serialize)]
struct MetadataSnapshot {
    path: String,
    content: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct MetadataTransaction {
    files: Vec<MetadataSnapshot>,
}

fn metadata_transaction_path(cwd: &str) -> String {
    format!("{}/.dpm-metadata-transaction.json", normalized_cwd(cwd))
}

fn normalized_cwd(cwd: &str) -> String {
    let mut parts = Vec::new();
    for part in cwd.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    format!("/{}", parts.join("/"))
}

fn valid_package_part(part: &str) -> bool {
    !part.is_empty()
        && !part.starts_with('.')
        && part.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn valid_package_name(name: &str) -> bool {
    if let Some(scoped) = name.strip_prefix('@') {
        let Some((scope, package)) = scoped.split_once('/') else {
            return false;
        };
        !package.contains('/') && valid_package_part(scope) && valid_package_part(package)
    } else {
        !name.contains('/') && valid_package_part(name)
    }
}

fn valid_transaction_paths(transaction: &MetadataTransaction, cwd: &str) -> bool {
    let cwd = normalized_cwd(cwd);
    let manifest = format!("{cwd}/package.json");
    let lock = format!("{cwd}/package-lock.json");
    let package_prefix = format!("{cwd}/node_modules/");
    let mut manifest_seen = false;
    let mut lock_seen = false;
    let mut package_seen = false;
    if !(transaction.files.len() == 2 || transaction.files.len() == 3) {
        return false;
    }
    for snapshot in &transaction.files {
        if snapshot.path == manifest && !manifest_seen {
            manifest_seen = true;
        } else if snapshot.path == lock && !lock_seen {
            lock_seen = true;
        } else if transaction.files.len() == 3
            && !package_seen
            && snapshot
                .path
                .strip_prefix(&package_prefix)
                .and_then(|path| path.strip_suffix("/package.json"))
                .is_some_and(valid_package_name)
        {
            package_seen = true;
        } else {
            return false;
        }
    }
    manifest_seen && lock_seen && (transaction.files.len() == 2 || package_seen)
}

async fn snapshot<H: HostCapabilities>(host: &H, path: String) -> Result<MetadataSnapshot, String> {
    let content = if host.exists(&path).await? {
        Some(host.read(&path).await?)
    } else {
        None
    };
    Ok(MetadataSnapshot { path, content })
}

async fn recover_metadata_transaction<H: HostCapabilities>(
    host: &H,
    cwd: &str,
) -> Result<(), String> {
    let journal_path = metadata_transaction_path(cwd);
    if !host.exists(&journal_path).await? {
        return Ok(());
    }
    let transaction: MetadataTransaction =
        serde_json::from_str(&host.read(&journal_path).await?)
            .map_err(|error| format!("invalid metadata transaction journal: {error}"))?;
    if !valid_transaction_paths(&transaction, cwd) {
        return Err("invalid metadata transaction journal paths".to_owned());
    }
    for snapshot in transaction.files.iter().rev() {
        match &snapshot.content {
            Some(content) => host.atomic_write(&snapshot.path, content).await?,
            None if host.exists(&snapshot.path).await? => host.remove(&snapshot.path).await?,
            None => {}
        }
    }
    host.remove(&journal_path).await
}

fn package_request(request: &str) -> (&str, Option<&str>) {
    if !request.starts_with('@') {
        return request
            .rsplit_once('@')
            .map_or((request, None), |(name, version)| (name, Some(version)));
    }
    let Some(index) = request[1..].rfind('@') else {
        return (request, None);
    };
    let index = index + 1;
    (&request[..index], Some(&request[index + 1..]))
}

fn frozen_lock_entry<'a>(lock: &'a Value, path: &str, name: &str) -> Result<&'a Value, String> {
    lock.pointer("/packages")
        .and_then(Value::as_object)
        .and_then(|packages| packages.get(path))
        .filter(|entry| entry.get("name").and_then(Value::as_str) == Some(name))
        .ok_or_else(|| format!("frozen lockfile divergence: missing lock entry for {name}"))
}

#[async_recursion::async_recursion(?Send)]
async fn install_locked_package<H: HostCapabilities>(
    transaction: &mut InstallTransaction<'_, H>,
    cwd: &str,
    lock: &Value,
    name: &str,
    directory: &str,
) -> Result<(), String> {
    let lock_path = directory
        .find("/node_modules/")
        .map(|index| &directory[index + 1..])
        .unwrap_or_else(|| directory.strip_prefix('/').unwrap_or(directory));
    let entry = frozen_lock_entry(lock, lock_path, name)?;
    let version = entry
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("frozen lockfile divergence: missing version for {name}"))?;
    let integrity = entry
        .get("integrity")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!("frozen lockfile divergence: missing integrity for {name}@{version}")
        })?;
    let bytes = read_cached_tarball(transaction.host, cwd, integrity, name, version).await?;
    transaction.host.mkdir(directory).await?;
    extract_tarball(transaction, &bytes, directory).await?;
    let manifest: Value = serde_json::from_str(
        &transaction
            .host
            .read(&format!("{directory}/package.json"))
            .await?,
    )
    .map_err(|error| format!("invalid installed package manifest for {name}@{version}: {error}"))?;
    if let Some(dependencies) = manifest.get("dependencies").and_then(Value::as_object) {
        for dependency in dependencies.keys() {
            install_locked_package(
                transaction,
                cwd,
                lock,
                dependency,
                &format!("{directory}/node_modules/{dependency}"),
            )
            .await?;
        }
    }
    Ok(())
}

async fn install_from_lock<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    request: &str,
    frozen: bool,
) -> CommandResult {
    let (name, _) = package_request(request);
    if !valid_package_name(name) {
        return failure(format!("invalid package name: {name}"));
    }
    let manifest_path = format!("{cwd}/package.json");
    let manifest: Value = match host
        .read(&manifest_path)
        .await
        .and_then(|body| serde_json::from_str(&body).map_err(|error| error.to_string()))
    {
        Ok(manifest) => manifest,
        Err(error) => return failure(format!("cannot read {manifest_path}: {error}")),
    };
    let lock_path = format!("{cwd}/package-lock.json");
    let lock: Value = match host
        .read(&lock_path)
        .await
        .and_then(|body| serde_json::from_str(&body).map_err(|error| error.to_string()))
    {
        Ok(lock) => lock,
        Err(_) => {
            return failure(format!(
                "offline cache miss for {name}: lockfile is required"
            ));
        }
    };
    let entry = match frozen_lock_entry(&lock, &format!("node_modules/{name}"), name) {
        Ok(entry) => entry,
        Err(error) => return failure(error),
    };
    let version = match entry.get("version").and_then(Value::as_str) {
        Some(version) => version,
        None => {
            return failure(format!(
                "frozen lockfile divergence: missing version for {name}"
            ));
        }
    };
    let dependency = manifest
        .pointer(&format!("/dependencies/{name}"))
        .and_then(Value::as_str);
    let valid_dependency = dependency
        .and_then(|range| npm_version_requirements(range).ok())
        .and_then(|requirements| {
            Version::parse(version)
                .ok()
                .map(|version| requirements.iter().any(|requirement| requirement.matches(&version)))
        })
        .unwrap_or_else(|| {
            dependency.is_some_and(|source| {
                source.starts_with("file:")
                    && entry
                        .get("resolved")
                        .and_then(Value::as_str)
                        .is_some_and(|resolved| resolved.starts_with("file:"))
            })
        });
    if frozen && !valid_dependency {
        return failure(format!(
            "frozen lockfile divergence: {name}@{version} does not satisfy the manifest"
        ));
    }
    let mut transaction = InstallTransaction::new(host);
    let result = install_locked_package(
        &mut transaction,
        cwd,
        &lock,
        name,
        &format!("{cwd}/node_modules/{name}"),
    )
    .await;
    if let Err(error) = result {
        transaction.rollback().await;
        return failure(error);
    }
    let stdout = format!("installed {name}@{version}\n");
    let _ = host.stdout(&stdout).await;
    CommandResult {
        status: 0,
        stdout,
        stderr: String::new(),
        plan: None,
    }
}

async fn install_one<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    registry: &str,
    fallback_registry: Option<&str>,
    request: &str,
) -> CommandResult {
    let mut root_package = match root_tarball_source(request, cwd) {
        Ok(Some(source)) => match load_root_tarball(host, source, cwd).await {
            Ok(tarball) => Some(RootPackage {
                tarball,
                link: false,
                workspace: false,
            }),
            Err(error) => return failure(error),
        },
        Ok(None) => None,
        Err(error) => return failure(error),
    };
    let manifest_path = format!("{cwd}/package.json");
    let mut manifest = match host.exists(&manifest_path).await {
        Ok(true) => match host.read(&manifest_path).await {
            Ok(body) => match serde_json::from_str(&body) {
                Ok(manifest) => manifest,
                Err(error) => return failure(format!("invalid {manifest_path}: {error}")),
            },
            Err(error) => return failure(format!("cannot read {manifest_path}: {error}")),
        },
        Ok(false) => json!({}),
        Err(error) => return failure(format!("cannot inspect {manifest_path}: {error}")),
    };
    if !manifest.is_object() {
        return failure(format!("invalid {manifest_path}: expected JSON object"));
    }
    if !manifest.get("dependencies").map_or(true, Value::is_object) {
        return failure(format!(
            "invalid {manifest_path}: dependencies must be an object"
        ));
    }
    let (_, requested) = package_request(request);
    let (name, version, package) = if let Some(root) = &root_package {
        (
            root.tarball.name.clone(),
            root.tarball.version.clone(),
            json!({}),
        )
    } else {
        let (name, requested) = package_request(request);
        if !valid_package_name(name) {
            return failure(format!("invalid package name: {name}"));
        }
        if requested.is_some_and(|range| range.starts_with("workspace:")) {
            match load_workspace_package(host, cwd, &manifest, name, requested.unwrap()).await {
                Ok(root) => {
                    let version = root.tarball.version.clone();
                    root_package = Some(root);
                    (name.to_owned(), version, json!({}))
                }
                Err(error) => return failure(error),
            }
        } else {
            match resolve_registry_package(host, registry, fallback_registry, name, requested).await {
                Ok((version, package)) => (name.to_owned(), version, package),
                Err(error) => return failure(error),
            }
        }
    };
    manifest["dependencies"][&name] = Value::String(root_package.as_ref().map_or_else(
        || format!("^{version}"),
        |root| {
            if root.workspace {
                requested.unwrap_or(request).to_owned()
            } else {
                request.to_owned()
            }
        },
    ));
    let package_dir = format!("{cwd}/node_modules/{name}");
    let lock_path = format!("{cwd}/package-lock.json");
    let mut lock = match host.exists(&lock_path).await {
        Ok(true) => match host.read(&lock_path).await {
            Ok(body) => match serde_json::from_str(&body) {
                Ok(lock) => lock,
                Err(error) => return failure(format!("invalid {lock_path}: {error}")),
            },
            Err(error) => return failure(format!("cannot read {lock_path}: {error}")),
        },
        Ok(false) => json!({}),
        Err(error) => return failure(format!("cannot inspect {lock_path}: {error}")),
    };
    if !lock.is_object() {
        return failure(format!("invalid {lock_path}: expected JSON object"));
    }
    if lock
        .get("packages")
        .is_some_and(|packages| !packages.is_object())
    {
        return failure(format!("invalid {lock_path}: packages must be an object"));
    }
    lock["name"] = manifest.get("name").cloned().unwrap_or(Value::Null);
    lock["lockfileVersion"] = json!(3);
    if !lock["packages"].is_object() {
        lock["packages"] = json!({});
    }
    lock["packages"][""] = manifest.clone();
    if let Err(error) = host.mkdir(&format!("{cwd}/node_modules")).await {
        return failure(format!("cannot create install directory: {error}"));
    }
    if root_package.is_none()
        && package.pointer("/dist/integrity").is_none()
        && package.pointer("/dist/shasum").is_none()
    {
        return failure(format!(
            "registry did not provide integrity for {name}@{version}"
        ));
    }
    let mut transaction = InstallTransaction::new(host);
    let result: Result<Option<String>, String> = async {
        if let Some(root) = &root_package {
            let tarball = &root.tarball;
            transaction.host.mkdir(&package_dir).await?;
            extract_staged_tarball(&mut transaction, &tarball.files, &package_dir).await?;
            let mut entry = lock_entry(
                &name,
                &version,
                &tarball.resolved,
                Value::String(tarball.integrity.clone()),
                &tarball.manifest,
            );
            if root.link {
                entry["link"] = json!(true);
            }
            if root.workspace {
                entry["workspace"] = json!(true);
            }
            lock["packages"][format!("node_modules/{name}")] = entry;
            let mut active = std::collections::BTreeSet::new();
            active.insert(format!("{name}@{version}"));
            install_required_peers(
                &mut transaction,
                cwd,
                registry,
                fallback_registry,
                &tarball.manifest,
                &mut lock,
                &mut active,
            )
            .await?;
            for (dependency, range) in &tarball.dependencies {
                if !valid_package_name(dependency) {
                    return Err(format!("invalid dependency name: {dependency}"));
                }
                let range = range
                    .as_str()
                    .ok_or_else(|| format!("invalid dependency spec for {dependency}"))?;
                if range.starts_with("git+")
                    || range.starts_with("file:")
                    || range.starts_with("workspace:")
                    || range.contains('/')
                {
                    return Err(format!("unsupported dependency spec for {dependency}: {range}"));
                }
                install_package_inner(
                    &mut transaction,
                    cwd,
                    registry,
                    fallback_registry,
                    dependency,
                    Some(range),
                    &format!("{package_dir}/node_modules/{dependency}"),
                    &mut lock,
                    &mut active,
                )
                .await?;
            }
        } else {
            install_package(&mut transaction, cwd, registry, fallback_registry, &name, Some(&version), &package_dir, &mut lock).await?;
        }
        let installed_manifest: Value = match host.read(&format!("{package_dir}/package.json")).await {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| package.clone()),
            Err(_) => package.clone(),
        };
        let scripts_warning = installed_manifest.pointer("/scripts").and_then(Value::as_object).is_some_and(|scripts| !scripts.is_empty())
            .then(|| format!("dpm npm: lifecycle scripts for {name}@{version} were not run (scripts are disabled)\n"));
        if let Some(bin) = installed_manifest.pointer("/bin") {
        let bins: Vec<(String, String)> = match bin {
            Value::String(path) => vec![(name.rsplit('/').next().unwrap_or(&name).to_owned(), path.to_owned())],
            Value::Object(entries) => {
                let mut bins = Vec::new();
                for (bin, path) in entries {
                    let Some(path) = path.as_str() else { return Err(format!("invalid bin metadata for {name}@{version}")); };
                    bins.push((bin.clone(), path.to_owned()));
                }
                bins
            },
            _ => return Err(format!("invalid bin metadata for {name}@{version}")),
        };
        for (bin, path) in bins {
            let path = path.trim_start_matches("./");
            if bin.is_empty() || bin == "." || bin == ".." || bin.contains(['/', '\\']) || bin.bytes().any(|byte| byte.is_ascii_control()) || path.split('/').any(|part| part.is_empty() || part == "." || part == "..") { return Err(format!("invalid bin metadata for {name}@{version}")); }
            let shim = format!("#!/usr/bin/env node\nglobalThis.__duskBinTarget = {:?};\n", format!("{package_dir}/{path}"));
            host.mkdir(&format!("{cwd}/node_modules/.bin")).await.map_err(|error| format!("cannot create bin directory: {error}"))?;
            transaction.write(&format!("{cwd}/node_modules/.bin/{bin}"), &shim).await.map_err(|error| format!("cannot write bin shim: {error}"))?;
        }
        }
        let writes = vec![
            (manifest_path, serde_json::to_string_pretty(&manifest).unwrap() + "\n"),
            (lock_path, serde_json::to_string_pretty(&lock).unwrap() + "\n"),
        ];
        let journal_path = metadata_transaction_path(cwd);
        let journal = serde_json::to_string(&MetadataTransaction { files: vec![
            snapshot(host, writes[0].0.clone()).await?,
            snapshot(host, writes[1].0.clone()).await?,
        ] }).map_err(|error| format!("cannot serialize metadata transaction: {error}"))?;
        transaction.write(&journal_path, &journal).await.map_err(|error| format!("cannot persist metadata transaction: {error}"))?;
        for (path, contents) in writes {
            transaction.write(&path, &contents).await.map_err(|error| format!("cannot write {path}: {error}"))?;
        }
        host.remove(&journal_path).await.map_err(|error| format!("cannot complete metadata transaction: {error}"))?;
        Ok(scripts_warning)
    }.await;
    let scripts_warning = match result {
        Ok(scripts_warning) => scripts_warning,
        Err(error) => {
            transaction.rollback().await;
            return failure(error);
        }
    };
    let stdout = format!("installed {name}@{version}\n");
    let _ = host.stdout(&stdout).await;
    CommandResult {
        status: 0,
        stdout,
        stderr: scripts_warning.unwrap_or_default(),
        plan: None,
    }
}

async fn install_many<H: HostCapabilities>(
    host: &H,
    cwd: &str,
    registry: &str,
    fallback_registry: Option<&str>,
    requests: &[String],
    offline: bool,
    frozen: bool,
) -> CommandResult {
    let batch = BatchHost::new(host);
    let mut stdout = String::new();
    let mut stderr = String::new();

    for request in requests {
        let local_source = matches!(
            root_tarball_source(request, cwd),
            Ok(Some(RootTarballSource::File(_) | RootTarballSource::Directory(_)))
        );
        let result = if frozen || (offline && !local_source) {
            install_from_lock(&batch, cwd, request, frozen).await
        } else {
            install_one(&batch, cwd, registry, fallback_registry, request).await
        };
        if result.status != 0 {
            batch.rollback().await;
            return result;
        }
        stdout.push_str(&result.stdout);
        stderr.push_str(&result.stderr);
    }

    CommandResult { status: 0, stdout, stderr, plan: None }
}

pub async fn npm_command<H: HostCapabilities>(
    args: &[String],
    host: &H,
    cwd: &str,
) -> CommandResult {
    npm_command_with_context(args, host, cwd, &ExecutionContext::default(), NPM_REGISTRY, false).await
}

async fn npm_command_with_context<H: HostCapabilities>(
    args: &[String],
    host: &H,
    cwd: &str,
    context: &ExecutionContext,
    default_registry: &str,
    use_dpm_registry: bool,
) -> CommandResult {
    if args
        .first()
        .is_some_and(|arg| arg == "--help" || arg == "-h")
    {
        let result = CommandResult {
            status: 0,
            stdout: "dpm npm - npm-compatible commands\n\nnpm commands are executed by the Rust DPM core.\n".to_owned(),
            stderr: String::new(),
            plan: None,
        };
        let _ = host.stdout(&result.stdout).await;
        return result;
    }
    if args
        .first()
        .is_some_and(|arg| arg == "install" || arg == "i" || arg == "add")
    {
        let mut registry = if use_dpm_registry {
            context
                .env
                .get("DPM_REGISTRY")
                .map(String::as_str)
                .unwrap_or(default_registry)
        } else {
            default_registry
        };
        let mut requests = Vec::new();
        let mut offline = false;
        let mut frozen = false;
        let mut npm_fallback = use_dpm_registry;
        let mut index = 1;
        while index < args.len() {
            if args[index] == "--registry" {
                let Some(value) = args.get(index + 1) else {
                    return failure("--registry requires an HTTPS base URL ending in /");
                };
                registry = value;
                index += 2;
            } else if args[index] == "--offline" {
                offline = true;
                index += 1;
            } else if args[index] == "--frozen-lockfile" {
                frozen = true;
                index += 1;
            } else if args[index] == "--no-npm-fallback" {
                npm_fallback = false;
                index += 1;
            } else {
                requests.push(args[index].clone());
                index += 1;
            }
        }
        if requests.is_empty() {
            return failure("install requires a package name");
        }
        let needs_registry = !frozen && (!offline || requests.iter().any(|request| matches!(
            root_tarball_source(request, cwd),
            Ok(Some(RootTarballSource::File(_) | RootTarballSource::Directory(_)))
        )));
        let registry = if needs_registry {
            match registry_base(registry) {
                Ok(registry) => registry,
                Err(error) => return failure(error),
            }
        } else {
            registry
        };
        return install_many(
            host,
            cwd,
            registry,
            npm_fallback.then_some(NPM_REGISTRY),
            &requests,
            offline,
            frozen,
        ).await;
    }
    if args.first().is_some_and(|arg| arg == "exec") {
        let Some(command) = args.get(1) else {
            return failure("exec requires a command");
        };
        return CommandResult {
            status: 0,
            stdout: String::new(),
            stderr: String::new(),
            plan: Some(ExecutionPlan {
                command: command.clone(),
                args: args[2..].to_vec(),
                env: context.env.clone(),
                stdin: context.stdin.clone(),
            }),
        };
    }
    failure(format!(
        "command '{}' is not supported in the browser Rust core",
        args.first().map(String::as_str).unwrap_or("")
    ))
}

pub async fn execute<H: HostCapabilities>(args: &[String], host: &H, cwd: &str) -> CommandResult {
    execute_with_context(args, host, cwd, ExecutionContext::default()).await
}

pub async fn execute_with_context<H: HostCapabilities>(
    args: &[String],
    host: &H,
    cwd: &str,
    context: ExecutionContext,
) -> CommandResult {
    if let Err(error) = recover_metadata_transaction(host, cwd).await {
        return failure(format!("cannot recover metadata transaction: {error}"));
    }
    match args.first().map(String::as_str) {
        None | Some("--help" | "-h") => CommandResult {
            status: 0,
            stdout: "dpm - Dusk Package Manager\n\nUsage:\n  dpm install <binary>\n  dpm npm <npm arguments...>\n".to_owned(),
            stderr: String::new(),
            plan: None,
        },
        Some("npm") => npm_command_with_context(&args[1..], host, cwd, &context, NPM_REGISTRY, false).await,
        Some("install" | "i" | "add") => npm_command_with_context(args, host, cwd, &context, DPM_REGISTRY, true).await,
        Some(command) => CommandResult {
            status: 2,
            stdout: String::new(),
            stderr: format!("dpm: command '{command}' is not available in the browser Rust core yet\n"),
            plan: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::{BTreeMap, BTreeSet};

    struct FailingHost {
        files: RefCell<BTreeMap<String, String>>,
        writes: RefCell<Vec<String>>,
        fetches: RefCell<Vec<String>>,
    }

    #[async_trait(?Send)]
    impl HostCapabilities for FailingHost {
        async fn read(&self, path: &str) -> Result<String, String> {
            self.files
                .borrow()
                .get(path)
                .cloned()
                .ok_or_else(|| "missing".to_owned())
        }
        async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
            self.writes.borrow_mut().push(path.to_owned());
            if path.ends_with("package-lock.json") {
                return Err("disk full".to_owned());
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
        async fn fetch(&self, url: &str) -> Result<HttpResponse, String> {
            self.fetches.borrow_mut().push(url.to_owned());
            Ok(HttpResponse { status: 200, status_text: "OK".to_owned(), headers: Default::default(), body: r#"{"dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"chalk","version":"1.0.0","dist":{"tarball":"https://example.test/chalk.tgz"}}}}"#.to_owned() })
        }
        async fn stdout(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        async fn stderr(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn failed_install_keeps_existing_manifest_unchanged() {
        let host = FailingHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                "{\"name\":\"app\"}\n".to_owned(),
            )])),
            writes: RefCell::new(Vec::new()),
            fetches: RefCell::new(Vec::new()),
        };
        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "chalk".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
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
    }

    #[test]
    fn npm_exec_does_not_echo_a_success_result() {
        let host = FailingHost {
            files: RefCell::new(BTreeMap::new()),
            writes: RefCell::new(Vec::new()),
            fetches: RefCell::new(Vec::new()),
        };
        let result = futures::executor::block_on(npm_command(
            &[
                "exec".to_owned(),
                "/bin/dsh".to_owned(),
                "-c".to_owned(),
                "printf planned".to_owned(),
            ],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 0);
        assert_eq!(result.stdout, "");
        let plan = result
            .plan
            .expect("npm exec should return an execution plan");
        assert_eq!(plan.command, "/bin/dsh");
        assert_eq!(plan.args, ["-c", "printf planned"]);
        assert!(plan.env.is_empty());
        assert_eq!(plan.stdin, None);
    }

    #[test]
    fn resolves_legacy_relative_tarballs_against_the_registry_base() {
        assert_eq!(
            resolve_tarball_url("https://registry.example/npm/", "/tar/-/tar-0.1.0.tgz"),
            "https://registry.example/npm/tar/-/tar-0.1.0.tgz"
        );
        assert_eq!(
            resolve_tarball_url("https://registry.example/npm/", "https://cdn.example/tar-0.1.0.tgz"),
            "https://cdn.example/tar-0.1.0.tgz"
        );
    }

    #[test]
    fn invalid_existing_manifest_fails_without_writing_metadata_or_a_journal() {
        let original_manifest = "{not valid json}\n";
        let host = FailingHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                original_manifest.to_owned(),
            )])),
            writes: RefCell::new(Vec::new()),
            fetches: RefCell::new(Vec::new()),
        };

        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "chalk".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
        assert_eq!(
            host.files.borrow()["/project/package.json"],
            original_manifest
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/.dpm-metadata-transaction.json")
        );
        assert!(host.writes.borrow().is_empty());
    }

    #[test]
    fn invalid_existing_lock_fails_without_writing_metadata_or_a_journal() {
        let original_lock = "{not valid json}\n";
        let host = FailingHost {
            files: RefCell::new(BTreeMap::from([
                (
                    "/project/package.json".to_owned(),
                    "{\"name\":\"app\"}\n".to_owned(),
                ),
                (
                    "/project/package-lock.json".to_owned(),
                    original_lock.to_owned(),
                ),
            ])),
            writes: RefCell::new(Vec::new()),
            fetches: RefCell::new(Vec::new()),
        };

        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "chalk".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
        assert_eq!(
            host.files.borrow()["/project/package-lock.json"],
            original_lock
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/.dpm-metadata-transaction.json")
        );
        assert!(host.writes.borrow().is_empty());
    }

    #[test]
    fn invalid_package_requests_never_fetch_or_construct_metadata_paths() {
        for request in [
            "../../target",
            "@scope",
            "@scope/../../target",
            "@scope//package",
        ] {
            let host = FailingHost {
                files: RefCell::new(BTreeMap::new()),
                writes: RefCell::new(Vec::new()),
                fetches: RefCell::new(Vec::new()),
            };
            let result = futures::executor::block_on(npm_command(
                &["install".to_owned(), request.to_owned()],
                &host,
                "/project",
            ));

            assert_eq!(result.status, 1, "{request}");
            assert!(host.fetches.borrow().is_empty(), "{request}");
            assert!(host.writes.borrow().is_empty(), "{request}");
            assert!(
                host.files
                    .borrow()
                    .keys()
                    .all(|path| path.starts_with("/project/")),
                "{request}"
            );
        }
    }

    #[test]
    fn valid_ordinary_and_scoped_package_names_are_accepted() {
        assert!(valid_package_name("chalk"));
        assert!(valid_package_name("@scope/package-name"));
    }

    #[test]
    fn accepts_legacy_sha1_and_rejects_sha256_and_sha512_mismatches() {
        let bytes = b"verified tarball";
        assert!(legacy_sha1_matches(
            bytes,
            &format!("{:x}", Sha1::digest(bytes))
        ));
        assert!(!sri_matches(
            bytes,
            "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        ));
        assert!(!sri_matches(
            bytes,
            "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
        ));
    }

    #[test]
    fn rejects_unsafe_tar_paths_and_keeps_scoped_package_paths() {
        assert!(archive_path(std::path::Path::new("package/../escape.js"), Some("package")).is_err());
        assert!(archive_path(std::path::Path::new("other/index.js"), Some("package")).is_err());
        assert_eq!(
            archive_path(std::path::Path::new("package/@scope/package/index.js"), Some("package")).unwrap(),
            "@scope/package/index.js"
        );
    }

    #[test]
    fn selects_tags_and_highest_satisfying_semver_range() {
        let packument = json!({
            "dist-tags": { "next": "2.0.0", "latest": "1.2.0" },
            "versions": { "1.0.0": {}, "1.2.0": {}, "2.0.0": {} },
        });
        assert_eq!(selected_version(&packument, Some("next")).unwrap(), "2.0.0");
        assert_eq!(
            selected_version(&packument, Some("^1.0.0")).unwrap(),
            "1.2.0"
        );
    }

    #[test]
    fn selects_highest_version_for_spaced_npm_comparator_conjunction() {
        let packument = json!({
            "versions": { "0.3.0": {}, "0.9.0": {}, "1.0.0": {} },
        });

        assert_eq!(
            selected_version(&packument, Some(">= 0.3.0 < 1")).unwrap(),
            "0.9.0"
        );
    }

    #[test]
    fn rejects_malformed_npm_version_specs() {
        let packument = json!({ "versions": { "1.0.0": {} } });

        assert_eq!(
            selected_version(&packument, Some(">= 1.0.0 < nope")).unwrap_err(),
            "unsupported version spec: >= 1.0.0 < nope"
        );
    }

    #[test]
    fn git_sources_require_an_immutable_https_github_or_gitlab_commit() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        assert!(matches!(
            root_tarball_source(
                &format!("git+https://github.com/example/package.git#{commit}"),
                "/project"
            ),
            Ok(Some(_))
        ));
        for source in [
            "git+https://github.com/example/package.git#main",
            "git+https://github.com/example/package.git#v1.0.0",
            "git+ssh://github.com/example/package.git#0123456789abcdef0123456789abcdef01234567",
            "git+https://token@github.com/example/package.git#0123456789abcdef0123456789abcdef01234567",
            "git+http://github.com/example/package.git#0123456789abcdef0123456789abcdef01234567",
            "git+https://code.example/example/package.git#0123456789abcdef0123456789abcdef01234567",
            "git+https://github.com/example/package.git?subdir=src#0123456789abcdef0123456789abcdef01234567",
        ] {
            assert!(root_tarball_source(source, "/project").is_err(), "{source}");
        }
    }

    fn tarball(files: &[(&str, &str)]) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (path, contents) in files {
            let mut header = tar::Header::new_gnu();
            header.set_path(format!("package/{path}")).unwrap();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive.append(&header, contents.as_bytes()).unwrap();
        }
        archive.into_inner().unwrap()
    }

    struct DirectoryAwareHost {
        directories: RefCell<BTreeSet<String>>,
        bytes: RefCell<BTreeMap<String, Vec<u8>>>,
    }

    #[async_trait(?Send)]
    impl HostCapabilities for DirectoryAwareHost {
        async fn read(&self, _: &str) -> Result<String, String> {
            Err("not used".to_owned())
        }
        async fn atomic_write(&self, _: &str, _: &str) -> Result<(), String> {
            Err("not used".to_owned())
        }
        async fn remove(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        async fn exists(&self, _: &str) -> Result<bool, String> {
            Ok(false)
        }
        async fn mkdir(&self, path: &str) -> Result<(), String> {
            let parent = path.rsplit_once('/').map_or("/", |(parent, _)| parent);
            if !self.directories.borrow().contains(parent) {
                return Err(format!("ENOENT: no such directory {parent}"));
            }
            self.directories.borrow_mut().insert(path.to_owned());
            Ok(())
        }
        async fn fetch(&self, _: &str) -> Result<HttpResponse, String> {
            Err("not used".to_owned())
        }
        async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
            let parent = path.rsplit_once('/').map_or("/", |(parent, _)| parent);
            if !self.directories.borrow().contains(parent) {
                return Err(format!("ENOENT: no such directory {parent}"));
            }
            self.bytes.borrow_mut().insert(path.to_owned(), content.to_vec());
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
    fn nested_tar_file_creates_all_parents_before_atomic_write() {
        let host = DirectoryAwareHost {
            directories: RefCell::new(BTreeSet::from([
                "/".to_owned(),
                "/project".to_owned(),
                "/project/node_modules".to_owned(),
                "/project/node_modules/tar".to_owned(),
            ])),
            bytes: RefCell::new(BTreeMap::new()),
        };
        let mut transaction = InstallTransaction::new(&host);

        futures::executor::block_on(extract_tarball(
            &mut transaction,
            &tarball(&[("dist/commonjs/mkdir.js.map", "{}")]),
            "/project/node_modules/tar",
        ))
        .unwrap();

        assert!(host
            .directories
            .borrow()
            .contains("/project/node_modules/tar/dist/commonjs"));
        assert_eq!(
            host.bytes.borrow()["/project/node_modules/tar/dist/commonjs/mkdir.js.map"],
            b"{}"
        );
    }

    struct NestedDependencyHost {
        files: RefCell<BTreeMap<String, String>>,
        packuments: BTreeMap<String, String>,
        tarballs: BTreeMap<String, Vec<u8>>,
    }

    #[async_trait(?Send)]
    impl HostCapabilities for NestedDependencyHost {
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
            let name = url.rsplit('/').next().unwrap_or_default();
            Ok(HttpResponse {
                status: 200,
                status_text: "OK".to_owned(),
                headers: BTreeMap::new(),
                body: self
                    .packuments
                    .get(name)
                    .cloned()
                    .ok_or_else(|| "missing packument".to_owned())?,
            })
        }
        async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
            self.tarballs
                .get(url)
                .cloned()
                .ok_or_else(|| "missing tarball".to_owned())
        }
        async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
            self.files.borrow_mut().insert(
                path.to_owned(),
                String::from_utf8(content.to_vec()).unwrap(),
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
    fn installs_transitive_dependencies_under_their_parent_without_promoting_them() {
        let parent_tarball = tarball(&[("package.json", r#"{"name":"parent","version":"1.0.0"}"#)]);
        let child_tarball = tarball(&[("package.json", r#"{"name":"child","version":"1.0.0"}"#)]);
        let package = |name: &str, dependencies: Value, tarball: &[u8]| {
            json!({
                "dist-tags": { "latest": "1.0.0" },
                "versions": { "1.0.0": {
                    "name": name,
                    "version": "1.0.0",
                    "dependencies": dependencies,
                    "dist": {
                        "tarball": format!("https://registry.test/{name}.tgz"),
                        "shasum": format!("{:x}", Sha1::digest(tarball)),
                    },
                }},
            })
            .to_string()
        };
        let host = NestedDependencyHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                r#"{"name":"app"}"#.to_owned(),
            )])),
            packuments: BTreeMap::from([
                (
                    "parent".to_owned(),
                    package("parent", json!({ "child": "^1.0.0" }), &parent_tarball),
                ),
                (
                    "child".to_owned(),
                    package("child", json!({}), &child_tarball),
                ),
            ]),
            tarballs: BTreeMap::from([
                (
                    "https://registry.test/parent.tgz".to_owned(),
                    parent_tarball,
                ),
                ("https://registry.test/child.tgz".to_owned(), child_tarball),
            ]),
        };

        let result = futures::executor::block_on(npm_command(
            &["install".to_owned(), "parent".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 0, "{}", result.stderr);
        assert!(
            host.files
                .borrow()
                .contains_key("/project/node_modules/parent/node_modules/child/package.json")
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/node_modules/child/package.json")
        );
    }

    fn tar_link(kind: u8) -> Vec<u8> {
        let mut header = [0_u8; 512];
        header[..19].copy_from_slice(b"package/link-target");
        header[124..136].copy_from_slice(b"00000000000\0");
        header[156] = kind;
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        header[148..156].fill(b' ');
        let checksum: u32 = header.iter().map(|byte| u32::from(*byte)).sum();
        header[148..156].copy_from_slice(format!("{:06o}\0 ", checksum).as_bytes());
        let mut archive = header.to_vec();
        archive.resize(1536, 0);
        archive
    }

    #[test]
    fn rejects_symlink_and_hard_link_tar_entries_before_writing() {
        for kind in [b'2', b'1'] {
            let host = FailingHost {
                files: RefCell::new(BTreeMap::new()),
                writes: RefCell::new(Vec::new()),
                fetches: RefCell::new(Vec::new()),
            };
            let mut transaction = InstallTransaction::new(&host);
            let error = futures::executor::block_on(extract_tarball(
                &mut transaction,
                &tar_link(kind),
                "/project/node_modules/pkg",
            ))
            .unwrap_err();
            assert_eq!(error, "tarball links are not supported");
            assert!(host.writes.borrow().is_empty());
        }
    }

    #[test]
    fn forged_recovery_journal_cannot_escape_the_project() {
        let journal_path = "/project/.dpm-metadata-transaction.json";
        let journal = r#"{"files":[{"path":"/project/package.json","content":"{}"},{"path":"/project/package-lock.json","content":"{}"},{"path":"/outside/package.json","content":"forged"}]}"#;
        let host = FailingHost {
            files: RefCell::new(BTreeMap::from([
                (journal_path.to_owned(), journal.to_owned()),
                ("/outside/package.json".to_owned(), "unchanged".to_owned()),
            ])),
            writes: RefCell::new(Vec::new()),
            fetches: RefCell::new(Vec::new()),
        };

        let result = futures::executor::block_on(execute(
            &["npm".to_owned(), "--help".to_owned()],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
        assert_eq!(host.files.borrow()["/outside/package.json"], "unchanged");
        assert_eq!(host.files.borrow()[journal_path], journal);
        assert!(host.writes.borrow().is_empty());
    }

    struct InterruptedTransactionHost {
        files: RefCell<BTreeMap<String, String>>,
        lock_write_failed: RefCell<bool>,
        rollback_write_failed: RefCell<bool>,
    }

    #[async_trait(?Send)]
    impl HostCapabilities for InterruptedTransactionHost {
        async fn read(&self, path: &str) -> Result<String, String> {
            self.files
                .borrow()
                .get(path)
                .cloned()
                .ok_or_else(|| "missing".to_owned())
        }
        async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
            if path.ends_with("package-lock.json") && !*self.lock_write_failed.borrow() {
                *self.lock_write_failed.borrow_mut() = true;
                return Err("disk full".to_owned());
            }
            if path.ends_with("package.json")
                && !path.contains("node_modules")
                && *self.lock_write_failed.borrow()
                && !*self.rollback_write_failed.borrow()
            {
                *self.rollback_write_failed.borrow_mut() = true;
                return Err("rollback disk full".to_owned());
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
            Ok(HttpResponse { status: 200, status_text: "OK".to_owned(), headers: Default::default(), body: r#"{"dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"chalk","version":"1.0.0","dist":{"tarball":"https://example.test/chalk.tgz"}}}}"#.to_owned() })
        }
        async fn stdout(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        async fn stderr(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn next_operation_recovers_metadata_after_promotion_and_rollback_failures() {
        let original_manifest = "{\"name\":\"app\"}\n";
        let original_lock = "{\"lockfileVersion\":3,\"packages\":{}}\n";
        let host = InterruptedTransactionHost {
            files: RefCell::new(BTreeMap::from([
                (
                    "/project/package.json".to_owned(),
                    original_manifest.to_owned(),
                ),
                (
                    "/project/package-lock.json".to_owned(),
                    original_lock.to_owned(),
                ),
            ])),
            lock_write_failed: RefCell::new(false),
            rollback_write_failed: RefCell::new(false),
        };

        let failed = futures::executor::block_on(execute(
            &["npm".to_owned(), "install".to_owned(), "chalk".to_owned()],
            &host,
            "/project",
        ));
        assert_eq!(failed.status, 1);
        assert_eq!(
            host.files.borrow()["/project/package.json"],
            original_manifest
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/.dpm-metadata-transaction.json")
        );

        let recovered = futures::executor::block_on(execute(
            &["npm".to_owned(), "--help".to_owned()],
            &host,
            "/project",
        ));
        assert_eq!(recovered.status, 0);
        assert_eq!(
            host.files.borrow()["/project/package.json"],
            original_manifest
        );
        assert_eq!(
            host.files.borrow()["/project/package-lock.json"],
            original_lock
        );
        assert!(
            !host
                .files
                .borrow()
                .contains_key("/project/.dpm-metadata-transaction.json")
        );
    }

    struct CacheHost {
        files: RefCell<BTreeMap<String, String>>,
        bytes: RefCell<BTreeMap<String, Vec<u8>>>,
        packument: String,
        tarball: Vec<u8>,
        fetches: RefCell<usize>,
        byte_fetches: RefCell<usize>,
        network_enabled: RefCell<bool>,
    }

    #[async_trait(?Send)]
    impl HostCapabilities for CacheHost {
        async fn read(&self, path: &str) -> Result<String, String> {
            self.files
                .borrow()
                .get(path)
                .cloned()
                .or_else(|| {
                    self.bytes
                        .borrow()
                        .get(path)
                        .and_then(|bytes| String::from_utf8(bytes.clone()).ok())
                })
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
            self.bytes.borrow_mut().remove(path);
            Ok(())
        }
        async fn exists(&self, path: &str) -> Result<bool, String> {
            Ok(self.files.borrow().contains_key(path) || self.bytes.borrow().contains_key(path))
        }
        async fn mkdir(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        async fn fetch(&self, _: &str) -> Result<HttpResponse, String> {
            *self.fetches.borrow_mut() += 1;
            if !*self.network_enabled.borrow() {
                return Err("network disabled".to_owned());
            }
            Ok(HttpResponse {
                status: 200,
                status_text: "OK".to_owned(),
                headers: BTreeMap::new(),
                body: self.packument.clone(),
            })
        }
        async fn fetch_bytes(&self, _: &str) -> Result<Vec<u8>, String> {
            *self.byte_fetches.borrow_mut() += 1;
            if !*self.network_enabled.borrow() {
                return Err("network disabled".to_owned());
            }
            Ok(self.tarball.clone())
        }
        async fn read_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
            self.bytes
                .borrow()
                .get(path)
                .cloned()
                .ok_or_else(|| "missing bytes".to_owned())
        }
        async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
            self.bytes
                .borrow_mut()
                .insert(path.to_owned(), content.to_vec());
            Ok(())
        }
        async fn stdout(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        async fn stderr(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn cache_host(manifest: &str, tarball: Vec<u8>) -> CacheHost {
        let integrity = format!("sha512-{}", STANDARD.encode(Sha512::digest(&tarball)));
        CacheHost {
            files: RefCell::new(BTreeMap::from([(
                "/project/package.json".to_owned(),
                manifest.to_owned(),
            )])),
            bytes: RefCell::new(BTreeMap::new()),
            packument: json!({
                "dist-tags": { "latest": "1.0.0" },
                "versions": { "1.0.0": {
                    "name": "chalk", "version": "1.0.0",
                    "dist": { "tarball": "https://registry.test/chalk.tgz", "integrity": integrity }
                }}
            })
            .to_string(),
            tarball,
            fetches: RefCell::new(0),
            byte_fetches: RefCell::new(0),
            network_enabled: RefCell::new(true),
        }
    }

    #[test]
    fn offline_registry_install_uses_verified_cached_tarball_without_network() {
        let host = cache_host(
            "{\"name\":\"app\"}",
            tarball(&[("package.json", r#"{"name":"chalk","version":"1.0.0"}"#)]),
        );
        assert_eq!(
            futures::executor::block_on(npm_command(
                &["install".to_owned(), "chalk".to_owned()],
                &host,
                "/project"
            ))
            .status,
            0
        );
        let network_calls = (*host.fetches.borrow(), *host.byte_fetches.borrow());
        *host.network_enabled.borrow_mut() = false;

        let result = futures::executor::block_on(npm_command(
            &[
                "install".to_owned(),
                "--offline".to_owned(),
                "chalk".to_owned(),
            ],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 0, "{}", result.stderr);
        assert_eq!(
            (*host.fetches.borrow(), *host.byte_fetches.borrow()),
            network_calls
        );
    }

    #[test]
    fn offline_registry_cache_miss_is_clear_and_never_fetches() {
        let tarball = tarball(&[("package.json", r#"{"name":"chalk","version":"1.0.0"}"#)]);
        let host = cache_host(
            "{\"name\":\"app\",\"dependencies\":{\"chalk\":\"^1.0.0\"}}",
            tarball,
        );
        host.files.borrow_mut().insert("/project/package-lock.json".to_owned(), r#"{"lockfileVersion":3,"packages":{"node_modules/chalk":{"name":"chalk","version":"1.0.0","resolved":"https://registry.test/chalk.tgz","integrity":"sha512-missing"}}}"#.to_owned());
        *host.network_enabled.borrow_mut() = false;

        let result = futures::executor::block_on(npm_command(
            &[
                "install".to_owned(),
                "--offline".to_owned(),
                "chalk".to_owned(),
            ],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
        assert!(
            result.stderr.contains("offline cache miss for chalk@1.0.0"),
            "{}",
            result.stderr
        );
        assert_eq!(*host.fetches.borrow(), 0);
        assert_eq!(*host.byte_fetches.borrow(), 0);
    }

    #[test]
    fn frozen_lockfile_rejects_manifest_divergence_without_writes() {
        let host = cache_host(
            "{\"name\":\"app\",\"dependencies\":{\"chalk\":\"^2.0.0\"}}",
            tarball(&[("package.json", r#"{"name":"chalk","version":"1.0.0"}"#)]),
        );
        let original_lock = r#"{"lockfileVersion":3,"packages":{"node_modules/chalk":{"name":"chalk","version":"1.0.0","resolved":"https://registry.test/chalk.tgz","integrity":"sha512-missing"}}}"#;
        host.files.borrow_mut().insert(
            "/project/package-lock.json".to_owned(),
            original_lock.to_owned(),
        );

        let result = futures::executor::block_on(npm_command(
            &[
                "install".to_owned(),
                "--frozen-lockfile".to_owned(),
                "chalk".to_owned(),
            ],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 1);
        assert!(
            result.stderr.contains("frozen lockfile divergence"),
            "{}",
            result.stderr
        );
        assert_eq!(
            host.files.borrow()["/project/package.json"],
            "{\"name\":\"app\",\"dependencies\":{\"chalk\":\"^2.0.0\"}}"
        );
        assert_eq!(
            host.files.borrow()["/project/package-lock.json"],
            original_lock
        );
    }

    #[test]
    fn local_tarballs_are_cached_by_their_deterministic_fingerprint_without_network() {
        let tarball = tarball(&[("package.json", r#"{"name":"local","version":"1.0.0"}"#)]);
        let host = cache_host("{\"name\":\"app\"}", tarball.clone());
        host.bytes
            .borrow_mut()
            .insert("/project/local.tgz".to_owned(), tarball);
        *host.network_enabled.borrow_mut() = false;

        let result = futures::executor::block_on(npm_command(
            &[
                "install".to_owned(),
                "--offline".to_owned(),
                "file:local.tgz".to_owned(),
            ],
            &host,
            "/project",
        ));

        assert_eq!(result.status, 0, "{}", result.stderr);
        assert_eq!(*host.fetches.borrow(), 0);
        assert_eq!(*host.byte_fetches.borrow(), 0);
        assert!(
            host.bytes
                .borrow()
                .keys()
                .any(|path| path.starts_with("/project/.dpm-cache/"))
        );
    }
}
