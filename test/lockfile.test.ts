import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildLockfile, readLockfile, writeLockfile } from '../src/core/lockfile';
import type { ResolvedDep } from '../src/types';

test('buildLockfile produces npm v3 shape', () => {
  const resolved = new Map<string, ResolvedDep>();
  resolved.set('node_modules/lodash', {
    name: 'lodash',
    version: '4.17.21',
    tarballUrl: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
    integrity: 'sha512-abc',
    registry: 'https://registry.dusk.night-x.com/',
    dependencies: {},
    isDev: false,
    installPath: 'node_modules/lodash',
  });

  const lockfile = buildLockfile('my-pkg', '1.0.0', { lodash: '^4.17.0' }, {}, resolved);
  expect(lockfile.lockfileVersion).toBe(3);
  expect(lockfile.requires).toBe(true);
  expect(lockfile.packages['']!.name).toBe('my-pkg');
  expect(lockfile.packages['']!.dependencies).toEqual({ lodash: '^4.17.0' });
  expect(lockfile.packages['node_modules/lodash']!.version).toBe('4.17.21');
  expect(lockfile.packages['node_modules/lodash']!.integrity).toBe('sha512-abc');
  expect(lockfile.packages['node_modules/lodash']!.registry).toBe('https://registry.dusk.night-x.com/');
});

test('lockfile roundtrip via writeLockfile/readLockfile', () => {
  const tmpDir = path.join(os.tmpdir(), `dpm-lf-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const resolved = new Map<string, ResolvedDep>();
  resolved.set('node_modules/foo', {
    name: 'foo',
    version: '1.0.0',
    tarballUrl: 'https://example.com/foo.tgz',
    integrity: 'sha512-xyz',
    dependencies: { bar: '^1.0' },
    isDev: false,
    installPath: 'node_modules/foo',
  });

  const lf = buildLockfile('proj', '0.0.1', { foo: '^1.0.0' }, {}, resolved);
  writeLockfile(tmpDir, lf);
  const back = readLockfile(tmpDir);
  expect(back).not.toBeNull();
  expect(back!.lockfileVersion).toBe(3);
  expect(back!.packages['node_modules/foo']!.version).toBe('1.0.0');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('buildLockfile handles nested install paths', () => {
  const resolved = new Map<string, ResolvedDep>();
  resolved.set('node_modules/rolldown', {
    name: 'rolldown',
    version: '1.1.3',
    tarballUrl: 'https://example.com/rolldown-1.1.3.tgz',
    dependencies: {},
    isDev: false,
    installPath: 'node_modules/rolldown',
  });
  resolved.set('node_modules/vite', {
    name: 'vite',
    version: '8.0.3',
    tarballUrl: 'https://example.com/vite-8.0.3.tgz',
    dependencies: { rolldown: '1.0.0-rc.12' },
    isDev: false,
    installPath: 'node_modules/vite',
  });
  resolved.set('node_modules/vite/node_modules/rolldown', {
    name: 'rolldown',
    version: '1.0.0-rc.12',
    tarballUrl: 'https://example.com/rolldown-1.0.0-rc.12.tgz',
    dependencies: {},
    isDev: false,
    installPath: 'node_modules/vite/node_modules/rolldown',
    parentPath: 'node_modules/vite',
  });

  const lf = buildLockfile('demo', '1.0.0', { vite: '^8.0.3', rolldown: '^1.0.2' }, {}, resolved);
  expect(lf.packages['node_modules/rolldown']!.version).toBe('1.1.3');
  expect(lf.packages['node_modules/vite']!.version).toBe('8.0.3');
  expect(lf.packages['node_modules/vite/node_modules/rolldown']!.version).toBe('1.0.0-rc.12');
});
