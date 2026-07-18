# @nightnetwork/dpm — Dusk Package Manager

A fast, npm-compatible package manager built for both Node.js and DuskJS runtimes.

## Features

- **Full npm compatibility** — drop-in replacement for `npm`, `npx`, and `pnpm` commands
- **Registry support** — works with the public npm registry and custom registries
- **Lockfile support** — generates and reads `package-lock.json` v3 format
- **Content-addressable cache** — SHA-512 integrity-based caching for fast offline installs
- **Integrity verification** — SHA-1, SHA-256, and SHA-512 SRI verification of all tarballs
- **Bin shims** — automatic `node_modules/.bin` shim generation with native binary detection
- **Semver resolution** — built-in semver parser supporting `^`, `~`, hyphen ranges, x-ranges, `||` alternatives, and prerelease tags
- **Dependency hoisting** — npm-compatible hoisting with nested fallback for version conflicts
- **Parallel installs** — concurrent BFS dependency resolution and parallel tarball fetching
- **Lifecycle scripts** — runs `preinstall`, `install`, `postinstall`, `prepublish`, and `prepare` scripts
- **CLI aliases** — provides `npm`, `npx`, and `pnpm` compatibility shims
- **Dual runtime** — works in standard Node.js and as `/bin/dpm` inside DuskJS

## Installation

```bash
npm install -g @nightnetwork/dpm
```

## CLI Usage

```
dpm — Dusk Package Manager

Usage:
  dpm install [packages...]     Install dependencies (alias: dpm i, dpm add)
  dpm uninstall <pkg>           Remove a package (alias: dpm rm, dpm remove)
  dpm run <script> [args...]    Run a package.json script
  dpm exec <command> [args...]  Run a local-bin command
  dpm list                      List installed packages
  dpm init [--yes]              Initialize a new package.json
  dpm cache <clean|verify|ls>   Manage the cache
  dpm config <get|set|delete>   Manage config
  dpm --version                 Print dpm version
  dpm --help                    Show help

Options:
  -D, --save-dev                Save to devDependencies
  -S, --save                    Save to dependencies (default)
  --silent                      Suppress output
  --registry <url>              Custom registry URL
```

### Install dependencies

```bash
# Install all dependencies from package.json
dpm install

# Add a package to dependencies
dpm install express

# Add a package to devDependencies
dpm install -D vitest

# Install from a custom registry
dpm install --registry https://registry.example.com
```

### Remove a package

```bash
dpm uninstall lodash
# or
dpm rm lodash
```

### Run scripts

```bash
dpm run build
dpm run test -- --watch
```

### Execute binaries

```bash
# Run a locally installed binary
dpm exec vitest

# Run with dpx (like npx)
dpx create-react-app my-app
dpx -p typescript tsc --init
```

### List installed packages

```bash
dpm list
```

### Initialize a project

```bash
dpm init
dpm init --yes
```

### Cache management

```bash
dpm cache ls
dpm cache verify
dpm cache clean
```

### Configuration

```bash
dpm config get registry
dpm config set registry https://registry.example.com
dpm config delete registry
```

## npm / npx / pnpm Compatibility

dpm ships with compatibility aliases that map directly to dpm commands:

| Alias | Maps to |
|-------|--------|
| `npm install` | `dpm install` |
| `npm uninstall` | `dpm uninstall` |
| `npm run` | `dpm run` |
| `npm exec` | `dpm exec` |
| `npm list` | `dpm list` |
| `npm init` | `dpm init` |
| `npm cache` | `dpm cache` |
| `npm config` | `dpm config` |
| `npx <cmd>` | `dpx <cmd>` |
| `pnpm add` | `dpm install` |
| `pnpm remove` | `dpm uninstall` |
| `pnpm dlx` | `dpx` |
| `pnpm run` | `dpm run` |
| `pnpm exec` | `dpm exec` |
| `pnpm list` | `dpm list` |
| `pnpm init` | `dpm init` |

## Architecture

### Core Modules

| Module | Description |
|--------|------------|
| `core/resolver` | Concurrent BFS dependency resolver with npm-compatible hoisting and nested fallback. Handles registry semver ranges, URL tarballs, `file:` deps, and dist-tags. Includes a multi-pass hoisting algorithm that lifts nested packages to the highest conflict-free position. |
| `core/registry` | HTTP client for npm-compatible registries. Fetches packument metadata (abbreviated format) and tarball bytes. |
| `core/tarball` | Pure-TypeScript gzip decompression and ustar tar parser. Extracts tarballs to disk with configurable component stripping. |
| `core/lockfile` | Reads and writes `package-lock.json` in lockfile v3 format. Builds lockfile entries from the resolved dependency graph. |
| `core/cache` | Content-addressable filesystem cache using SHA-512 hex sharding (`<cacheDir>/<alg>/<AA>/<BB>/<hex>`). |
| `core/integrity` | Tarball integrity verification supporting SHA-512, SHA-256, and SHA-1 SRI hashes, plus legacy hex shasums. |
| `core/bin-shims` | Creates `node_modules/.bin` shims with automatic detection of native binaries (ELF/Mach-O/PE), shebanged scripts, and plain JS files. |
| `core/manifest` | `package.json` read/write helpers, dependency merging, and package root discovery. |
| `core/scripts` | Lifecycle script runner (`preinstall`, `install`, `postinstall`, `prepublish`, `prepare`) with npm-compatible environment variables. |
| `semver` | Minimal built-in semver implementation supporting `^`, `~`, `>`, `>=`, `<`, `<=`, `=`, `||`, hyphen ranges, x-ranges, and prerelease comparison. |

### Dependency Resolution Strategy

1. Walk the dependency graph in BFS waves with configurable concurrency
2. For each transitive dependency, try to satisfy with an already-hoisted version (walking up the parent chain)
3. If no compatible hoisted version exists, install at the highest level with no conflict
4. If a transitive dependency's range is incompatible with the hoisted version, install nested under the parent
5. Post-resolution hoisting pass lifts nested packages to the highest conflict-free ancestor
6. Single-path lift pass catches remaining deeply-nested packages that can be promoted

### Supported Spec Types

- **Registry semver ranges**: `^1.2.3`, `~1.0.0`, `>=1`, `*`, `latest`
- **URL tarballs**: `https://example.com/foo-1.0.0.tgz`
- **File dependencies**: `file:./packages/shared`
- **Dist-tags**: `latest`, `next`, etc.
- **npm aliases**: `npm:package@version`

## DuskJS Integration

When running inside [DuskJS](https://github.com/nightnetwork), dpm operates as the built-in package manager at `/bin/dpm`. The runtime is auto-detected via `detectRuntime()` and `isDuskJS()` helpers from `util/env`.

Key differences in DuskJS mode:
- Cache directory defaults to the DuskJS system cache path
- Registry URL can be overridden via DuskJS configuration
- Bin shims include a `/bin/node` fallback path for JS scripts without shebangs

## Configuration

dpm reads configuration via `dpm config`:

```bash
# Set a custom registry
dpm config set registry https://registry.example.com

# View current registry
dpm config get registry

# Remove a config key
dpm config delete registry
```

The `--registry` flag on install commands takes precedence over config values.

## Programmatic API

dpm exports its core modules for programmatic use:

```typescript
import {
  installCommand,
  uninstallCommand,
  createRegistryClient,
  resolveDeps,
  extractTarball,
  parseTar,
  verifyIntegrity,
  computeIntegrity,
  createCache,
  readPackageJson,
  writePackageJson,
  buildLockfile,
  readLockfile,
  writeLockfile,
  detectRuntime,
  isDuskJS,
  semver,
} from '@nightnetwork/dpm';

// Resolve dependencies programmatically
const registry = createRegistryClient('https://registry.npmjs.org');
const plan = await resolveDeps({
  registry,
  rootDeps: { express: '^4.18.0' },
});

console.log(`Resolved ${plan.resolved.size} packages`);
```

## Contributing

Contributions are welcome. Please open an issue or pull request on GitHub.

```bash
git clone https://github.com/nightnetwork/dpm.git
cd dpm
npm install
npm run build
npm run test
```

## License

Apache-2.0
