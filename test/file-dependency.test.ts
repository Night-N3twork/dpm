import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDeps } from '../src/core/resolver';
import type { RegistryClient } from '../src/core/registry';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('resolves registry dependencies declared by a local directory package', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpm-file-'));
  temporary.push(root);
  const local = path.join(root, 'local');
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({
    name: 'local-package', version: '2.0.0', dependencies: { 'registry-child': '^1.0.0' },
  }));
  const registry = {
    origin: 'https://registry.example/',
    getPackument: async () => ({
      name: 'registry-child',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'registry-child', version: '1.0.0', dependencies: {},
          dist: { tarball: 'https://registry.example/registry-child.tgz', integrity: 'sha512-test' },
        },
      },
    }),
  } as unknown as RegistryClient;

  const plan = await resolveDeps({ registry, rootDeps: { 'local-package': 'file:./local' }, rootDir: root });

  expect(plan.errors).toEqual([]);
  expect(plan.resolved.get('node_modules/local-package')).toMatchObject({
    version: '2.0.0', localPath: local, dependencies: { 'registry-child': '^1.0.0' },
  });
  expect(plan.resolved.get('node_modules/registry-child')).toMatchObject({ version: '1.0.0' });
});

test('rejects symlinks while copying a local directory package', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpm-file-'));
  temporary.push(root);
  const local = path.join(root, 'local');
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, 'package.json'), '{"name":"local-package","version":"1.0.0"}');
  fs.symlinkSync('/outside', path.join(local, 'escape'));

  const registry = { origin: 'https://registry.example/', getPackument: async () => { throw new Error('not called'); } } as unknown as RegistryClient;
  const plan = await resolveDeps({ registry, rootDeps: { 'local-package': 'file:./local' }, rootDir: root });

  expect(plan.errors).toContain(`Cannot resolve local-package@file:./local: Local package contains a symbolic link: ${path.join(local, 'escape')}`);
});
