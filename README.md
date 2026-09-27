# @nightnetwork/dpm

The 1.0.0 npm release is the Rust browser WebAssembly core of the Dusk Package Manager. It exports wasm-bindgen's default async initializer and `execute(args, capabilities, cwd, context)`. It does not install a terminal command, expose the legacy TypeScript API, or provide full npm CLI compatibility. The Rust terminal source remains in this repository but is not shipped in the npm package.

## Browser API

```js
import init, { execute } from '@nightnetwork/dpm';
import wasmUrl from '@nightnetwork/dpm/wasm?url'; // Vite-style asset URL

const wasmBytes = await fetch(wasmUrl).then((response) => response.arrayBuffer());
await init({ module_or_path: wasmBytes });

// Browser hosts provide the filesystem, network, and output boundary. Even
// --help checks for an interrupted metadata transaction before dispatch.
const capabilities = {
  exists: async () => false,
};
const result = await execute(['--help'], capabilities, '/project', {
  env: {},
});
console.log(result.status, result.stdout, result.stderr);
```

Resolve `@nightnetwork/dpm/wasm` as an asset URL with your browser bundler, or copy that subpath's WASM asset into your app. The default initializer can also fetch `dpm_wasm_bg.wasm` beside the generated JavaScript when both files are served with the correct MIME types. `execute` is asynchronous and returns `{ status, stdout, stderr, plan? }`.

Every invocation depends on browser-provided host capabilities; the package does not bundle filesystem or network implementations. The host must implement the methods reached by the selected command. A complete install host provides `read`, `atomicWrite`, `remove`, `exists`, `mkdir`, `fetch`, `fetchBytes`, `readBytes`, `readDir`, `stat`, `atomicWriteBytes`, `stdout`, and `stderr`. Binary capabilities exchange `Uint8Array` values, and `stat` returns `file`, `directory`, or `symlink`. See `src-rust/wasm.rs` for the complete interface.

## Supported Scope

The browser Rust core implements:

- `--help` and `-h`.
- `install`, `i`, and `add` for one or more named package requests. These use the DPM registry by default with npm fallback.
- `npm --help`, plus `npm install`, `npm i`, and `npm add` against the public npm registry.
- `npm exec <command> [args...]`, which returns an execution plan for the browser host to run; DPM does not execute the process itself.

Install supports `--registry <https-base-url>`, `--offline`, and `--frozen-lockfile`; direct DPM installs also support `--no-npm-fallback` and the `DPM_REGISTRY` execution-context variable. Root requests may use registry versions and tags, direct HTTPS `.tgz` URLs, `file:` directories or `.tgz` files, immutable `git+https` GitHub/GitLab commits, and `workspace:*` or `workspace:^` packages from array-form workspace declarations. The installer verifies and caches tarballs, safely extracts package files, installs registry dependencies in nested paths, resolves required and optional peers at the project root, writes lockfile metadata, and creates browser launchers for package bins.

This is not a complete npm CLI. Lifecycle scripts are disabled, transitive dependencies are limited to registry version specifications, workspace selectors and globs are intentionally restricted, Git sources must use supported hosts and immutable commits, and commands not listed above return an unavailable-command result.

## Building

Install Rust through rustup, then run `npm pack`. Cargo and the WASM build script automatically use the dated nightly toolchain and `wasm32-unknown-unknown` target pinned in `rust-toolchain.toml`. `prepack` installs the pinned wasm-bindgen CLI 0.2.108 locally if needed, builds the Rust library with Cargo, and generates the web-target JS bindings, WASM, and declarations in `dist/`. Set `WASM_BINDGEN` to an existing CLI binary only if it reports version 0.2.108. No sibling project is required. Run `cargo test`, `npm test`, `npm run test:package`, and `npm run test:browser` to verify the source, packed consumer, and generated package in Chromium. The browser test searches standard Chromium and Chrome installation paths on Linux, macOS, and Windows; set `CHROMIUM_PATH` when the executable is elsewhere. It never downloads a browser.

## License

Apache-2.0. See `LICENSE`.
