import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cargo = process.env.CARGO ?? 'cargo';
const toolRoot = resolve(root, '.wasm-bindgen');
const binary = process.env.WASM_BINDGEN ?? resolve(toolRoot, 'bin', `wasm-bindgen${process.platform === 'win32' ? '.exe' : ''}`);
const version = '0.2.108';

if (!process.env.WASM_BINDGEN) {
  try {
    if (execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim() !== `wasm-bindgen ${version}`) {
      throw new Error('wrong version');
    }
  } catch {
    execFileSync(cargo, ['install', 'wasm-bindgen-cli', '--version', version, '--locked', '--root', toolRoot, '--force'], { cwd: root, stdio: 'inherit' });
  }
}
const installed = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
if (installed !== `wasm-bindgen ${version}`) {
  throw new Error(`wasm-bindgen must be ${version}; found ${installed}`);
}

const rustflags = [
  process.env.RUSTFLAGS,
  `--remap-path-prefix=${homedir()}=/toolchain`,
  `--remap-path-prefix=${root}=/dpm`,
].filter(Boolean).join(' ');
execFileSync(cargo, ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: rustflags },
});
const output = resolve(root, 'dist');
mkdirSync(output, { recursive: true });
execFileSync(binary, [resolve(root, 'target/wasm32-unknown-unknown/release/dpm_wasm.wasm'), '--target', 'web', '--out-dir', output], { cwd: root, stdio: 'inherit' });
