import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDeps } from '../src/core/resolver';
import type { RegistryClient } from '../src/core/registry';
import type { Packument } from '../src/types';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const packument = (name: string, versions: Record<string, {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}>): Packument => ({
  name,
  'dist-tags': { latest: Object.keys(versions).at(-1)! },
  versions: Object.fromEntries(Object.entries(versions).map(([version, manifest]) => [version, {
    name,
    version,
    dependencies: {},
    ...manifest,
    dist: { tarball: `https://registry.example/${name}-${version}.tgz` },
  }])),
});

const registryFor = (packuments: Record<string, Packument>): RegistryClient => ({
  origin: 'https://registry.example/',
  getPackument: async (name: string) => packuments[name]!,
} as RegistryClient);

test('installs the highest required peer for a local package at the project root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpm-peer-'));
  temporary.push(root);
  const local = path.join(root, 'local-plugin');
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({
    name: 'local-plugin', version: '1.0.0', peerDependencies: { host: '^1.0.0' },
  }));

  const plan = await resolveDeps({
    registry: registryFor({ host: packument('host', { '1.0.0': {}, '1.9.0': {}, '2.0.0': {} }) }),
    rootDeps: { 'local-plugin': 'file:./local-plugin' },
    rootDir: root,
  });

  expect(plan.errors).toEqual([]);
  expect(plan.resolved.get('node_modules/host')?.version).toBe('1.9.0');
});

test('reuses a compatible root package for a required peer', async () => {
  const plan = await resolveDeps({
    registry: registryFor({
      plugin: packument('plugin', { '1.0.0': { peerDependencies: { host: '^1.0.0' } } }),
      host: packument('host', { '1.0.0': {}, '1.9.0': {}, '2.0.0': {} }),
    }),
    rootDeps: { plugin: '^1.0.0', host: '^1.0.0' },
  });

  expect(plan.errors).toEqual([]);
  expect([...plan.resolved.entries()].filter(([, dep]) => dep.name === 'host')).toEqual([
    ['node_modules/host', expect.objectContaining({ version: '1.9.0' })],
  ]);
});

test('reports a deterministic fatal conflict instead of nesting an incompatible peer', async () => {
  const registry = registryFor({
    alpha: packument('alpha', { '1.0.0': { peerDependencies: { host: '^1.0.0' } } }),
    beta: packument('beta', { '1.0.0': { peerDependencies: { host: '^2.0.0' } } }),
    host: packument('host', { '1.0.0': {}, '2.0.0': {} }),
  });

  const plan = await resolveDeps({ registry, rootDeps: { beta: '^1.0.0', alpha: '^1.0.0' } });

  expect((plan as { fatalErrors?: string[] }).fatalErrors).toEqual([
    'Peer dependency conflict: beta requires host@^2.0.0, but root has 1.0.0',
  ]);
  expect([...plan.resolved.keys()].filter((installPath) => installPath.endsWith('/host'))).toEqual(['node_modules/host']);
});

test('skips an optional peer', async () => {
  const plan = await resolveDeps({
    registry: registryFor({
      plugin: packument('plugin', {
        '1.0.0': {
          peerDependencies: { host: '^1.0.0' },
          peerDependenciesMeta: { host: { optional: true } },
        },
      }),
      host: packument('host', { '1.0.0': {} }),
    }),
    rootDeps: { plugin: '^1.0.0' },
  });

  expect(plan.errors).toEqual([]);
  expect(plan.resolved.has('node_modules/host')).toBe(false);
});
