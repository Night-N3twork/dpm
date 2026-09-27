import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifactLeakPattern = /(?<![A-Za-z0-9._:/-])(?:\/(?:home|Users)\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?|\/(?:root|workspace|workspaces)(?:\/[^\s"'<>]*)?|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\r\n"'<>]+(?:[\\/][^\r\n"'<>]*)?)|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|npm_[A-Za-z0-9]{20}/;

test('artifact leak detection covers common workstation paths without matching metadata', () => {
  for (const leaked of [
    '/home/alice/work/dpm',
    '/root/work/dpm',
    '/workspace/dpm/target',
    String.raw`C:\Users\alice\work\dpm`,
  ]) {
    assert.match(leaked, artifactLeakPattern);
  }
  for (const safe of [
    'https://example.test/home/alice/package.tgz',
    '/rustc/commit/library/std/src/lib.rs',
    '/toolchain/.cargo/registry/src/package.rs',
    '/dpm/src-rust/lib.rs',
  ]) {
    assert.doesNotMatch(safe, artifactLeakPattern);
  }
});

test('packed browser WASM package installs and executes without the source checkout', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dpm-package-'));
  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
    }));
    const paths = packed.files.map(({ path }) => path);
    assert.equal(packed.name, '@nightnetwork/dpm');
    assert.equal(packed.version, '1.0.0');
    assert.deepEqual(paths.sort(), [
      'LICENSE', 'README.md', 'dist/dpm_wasm.js', 'dist/dpm_wasm.d.ts',
      'dist/dpm_wasm_bg.wasm', 'dist/dpm_wasm_bg.wasm.d.ts', 'package.json',
    ].sort());

    const consumer = join(temporary, 'consumer');
    execFileSync('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], { stdio: 'pipe' });
    const manifest = JSON.parse(readFileSync(join(consumer, 'node_modules/@nightnetwork/dpm/package.json'), 'utf8'));
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.bin, undefined);
    assert.equal(manifest.exports['.'].default, './dist/dpm_wasm.js');
    assert.equal(manifest.exports['./wasm'], './dist/dpm_wasm_bg.wasm');
    assert.match(readFileSync(join(consumer, 'node_modules/@nightnetwork/dpm/LICENSE'), 'utf8'), /END OF TERMS AND CONDITIONS/);
    for (const path of paths) {
      const contents = readFileSync(join(consumer, 'node_modules/@nightnetwork/dpm', path)).toString('latin1');
      const leak = contents.match(artifactLeakPattern);
      assert.ok(!leak, leak && `${path}: ${contents.slice(Math.max(0, leak.index - 40), leak.index + 160)}`);
    }

    const smoke = join(consumer, 'smoke.mjs');
    writeFileSync(smoke, `import init, { execute } from '@nightnetwork/dpm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const bytes = await readFile(fileURLToPath(import.meta.resolve('@nightnetwork/dpm/wasm')));
await init({ module_or_path: bytes });
const output = [];
const result = await execute(['--help'], {
  exists: async () => false,
  read: async () => { throw Error('unexpected read'); },
  atomicWrite: async () => { throw Error('unexpected write'); },
  remove: async () => { throw Error('unexpected remove'); },
  mkdir: async () => { throw Error('unexpected mkdir'); },
  fetch: async () => { throw Error('unexpected fetch'); },
  stdout: async (text) => output.push(text),
  stderr: async (text) => output.push(text),
}, '/project', {});
assert.equal(result.status, 0);
assert.match(result.stdout, /Usage:/);
assert.equal(result.stderr, '');
`);
    execFileSync('node', [smoke], { cwd: consumer, stdio: 'pipe' });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
