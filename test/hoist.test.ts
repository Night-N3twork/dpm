import { test, expect, vi } from 'vitest';
import { resolveDeps } from '../src/core/resolver';
import type { Packument } from '../src/types';

const makePackument = (name: string, versions: Record<string, Record<string, string>>): Packument => {
  const vs: Packument['versions'] = {};
  for (const [v, deps] of Object.entries(versions)) {
    vs[v] = {
      name,
      version: v,
      dependencies: deps,
      dist: { tarball: `https://example.com/${name}-${v}.tgz` },
    };
  }
  return {
    name,
    versions: vs,
    'dist-tags': { latest: Object.keys(versions)[0]! },
  };
};

test('hoist: single version of a transitive dep hoists to root', async () => {
  const packuments: Record<string, Packument> = {
    'a': makePackument('a', { '1.0.0': { 'b': '^1.0.0' } }),
    'c': makePackument('c', { '1.0.0': { 'b': '^1.0.0' } }),
    'b': makePackument('b', { '1.0.0': {} }),
  };
  const registry = {
    getPackument: vi.fn(async (n: string) => packuments[n]!),
    getTarball: vi.fn(async () => new Uint8Array(0)),
  };

  const plan = await resolveDeps({
    registry: registry as never,
    rootDeps: { a: '^1.0.0', c: '^1.0.0' },
  });

  // 'b' should appear once at root
  const bPaths = [...plan.resolved.keys()].filter((k) => k.endsWith('/b'));
  expect(bPaths).toEqual(['node_modules/b']);
});

test('hoist: conflicting versions get hoisted to LCA', async () => {
  const packuments: Record<string, Packument> = {
    'root-a': makePackument('root-a', { '1.0.0': { 'foo': '^2.0.0' } }),
    'parent1': makePackument('parent1', { '1.0.0': { 'child': '^1.0.0' } }),
    'parent2': makePackument('parent2', { '1.0.0': { 'child': '^1.0.0' } }),
    'child': makePackument('child', { '1.0.0': { 'foo': '^1.0.0' } }),
    'foo': makePackument('foo', { '1.0.0': {}, '2.0.0': {} }),
  };
  const registry = {
    getPackument: vi.fn(async (n: string) => packuments[n]!),
    getTarball: vi.fn(async () => new Uint8Array(0)),
  };

  const plan = await resolveDeps({
    registry: registry as never,
    rootDeps: { 'root-a': '^1.0.0', 'parent1': '^1.0.0', 'parent2': '^1.0.0' },
  });

  // foo@2.0.0 should be at root (since root-a wants ^2.0.0)
  expect(plan.resolved.get('node_modules/foo')?.version).toBe('2.0.0');
  // foo@1.0.0 should appear ONCE (nested), not twice. With single-path lift,
  // it should land at a directly-under-parent location.
  const fooPaths = [...plan.resolved.keys()].filter((k) => k.endsWith('/foo'));
  const fooVersions = fooPaths.map((p) => plan.resolved.get(p)!.version).sort();
  expect(fooVersions).toEqual(['1.0.0', '2.0.0']);
  // The 1.0.0 path should be a single nested install (LCA is root, but root is taken).
  const oneFooPath = fooPaths.find((p) => plan.resolved.get(p)!.version === '1.0.0')!;
  expect(oneFooPath).toMatch(/node_modules\/child\/node_modules\/foo$/);
});

test('hoist: child is also hoisted (single-version transitive dep)', async () => {
  const packuments: Record<string, Packument> = {
    'parent1': makePackument('parent1', { '1.0.0': { 'child': '^1.0.0' } }),
    'parent2': makePackument('parent2', { '1.0.0': { 'child': '^1.0.0' } }),
    'child': makePackument('child', { '1.0.0': {} }),
  };
  const registry = {
    getPackument: vi.fn(async (n: string) => packuments[n]!),
    getTarball: vi.fn(async () => new Uint8Array(0)),
  };

  const plan = await resolveDeps({
    registry: registry as never,
    rootDeps: { 'parent1': '^1.0.0', 'parent2': '^1.0.0' },
  });

  // child should be hoisted to root since only one version is in use
  expect(plan.resolved.has('node_modules/child')).toBe(true);
  // No nested copies
  const childPaths = [...plan.resolved.keys()].filter((k) => k.endsWith('/child'));
  expect(childPaths).toEqual(['node_modules/child']);
});
