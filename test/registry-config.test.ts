import { afterEach, test, expect, vi } from 'vitest';
import { createRegistryClient, OFFICIAL_REGISTRY, resolveRegistry } from '../src/core/registry';
import { resolveDeps } from '../src/core/resolver';

const nativeFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

test('registry tests may replace fetch', () => {
  vi.stubGlobal('fetch', vi.fn());
});

test('registry global stubs are isolated between tests', () => {
  expect(globalThis.fetch).toBe(nativeFetch);
});

test('uses the official registry by default', () => {
  expect(resolveRegistry('left-pad', { cwd: '/project', env: {}, home: '/home/user' })).toBe(OFFICIAL_REGISTRY);
});

test('applies CLI, environment, project, and user registry precedence', () => {
  const files = new Map([
    ['/home/user/.npmrc', 'registry=https://user.example/'],
    ['/project/.npmrc', 'registry=https://project.example/'],
  ]);
  const options = {
    cwd: '/project', home: '/home/user',
    env: { DPM_REGISTRY: 'https://environment.example/' },
    readFile: (file: string) => files.get(file) ?? null,
  };

  expect(resolveRegistry('left-pad', options)).toBe('https://environment.example/');
  expect(resolveRegistry('left-pad', { ...options, cliRegistry: 'https://cli.example/' })).toBe('https://cli.example/');
  expect(resolveRegistry('left-pad', { ...options, env: {} })).toBe('https://project.example/');
});

test('selects the longest configured package scope', () => {
  const files = new Map([['/project/.npmrc', [
    'registry=https://project.example/',
    '@team:registry=https://team.example/',
    '@team-tools:registry=https://tools.example/',
  ].join('\n')]]);
  const options = { cwd: '/project', home: '/home/user', env: {}, readFile: (file: string) => files.get(file) ?? null };

  expect(resolveRegistry('@team-tools/cli', options)).toBe('https://tools.example/');
  expect(resolveRegistry('@team/widget', options)).toBe('https://team.example/');
  expect(resolveRegistry('left-pad', options)).toBe('https://project.example/');
});

test('rejects malformed registry configuration', () => {
  expect(() => resolveRegistry('left-pad', { cwd: '/project', home: '/home/user', env: { DPM_REGISTRY: 'not-a-url' } })).toThrow('Invalid registry URL');
  expect(() => resolveRegistry('@team/pkg', { cwd: '/project', home: '/home/user', env: {}, readFile: () => '@team:registry=not-a-url' })).toThrow('Invalid registry URL');
});

test('resolves legacy relative tarballs against the registry URL while preserving absolute URLs', async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetchMock);
  const registry = createRegistryClient('https://registry.example/npm/');

  await registry.getTarball('/tar/-/tar-0.1.0.tgz');
  await registry.getTarball('https://cdn.example/tar-0.1.0.tgz');

  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://registry.example/npm/tar/-/tar-0.1.0.tgz',
    'https://cdn.example/tar-0.1.0.tgz',
  ]);
});

test('routes scoped and unscoped packuments to their configured registries in one graph', async () => {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const name = url.endsWith('/%40team/widget') ? '@team/widget' : 'left-pad';
    return new Response(JSON.stringify({
      name,
      versions: {
        '1.0.0': {
          name,
          version: '1.0.0',
          dependencies: {},
          dist: { tarball: `${url}/-/${name.replace('@team/', '')}-1.0.0.tgz` },
        },
      },
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const files = new Map([['/project/.npmrc', [
    'registry=https://public.example/',
    '@team:registry=https://team.example/',
  ].join('\n')]]);
  const options = { cwd: '/project', home: '/home/user', env: {}, readFile: (file: string) => files.get(file) ?? null };
  const registryFor = (name: string) => createRegistryClient(resolveRegistry(name, options));

  const plan = await resolveDeps({
    registry: registryFor(''),
    registryFor,
    rootDeps: { '@team/widget': '^1.0.0', 'left-pad': '^1.0.0' },
  });

  expect(plan.errors).toEqual([]);
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://team.example/%40team/widget',
    'https://public.example/left-pad',
  ]);
});

test('falls back to npm for direct registry 404 packuments at every dependency depth', async () => {
  const dpm = 'https://registry.dusk.example/';
  const npm = 'https://registry.npmjs.org/';
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith(dpm)) return new Response('not found', { status: 404, statusText: 'Not Found' });
    const name = url.slice(npm.length);
    const dependencies = name === 'dpm-tar' ? { nanotar: '^1.0.0' } : {};
    return new Response(JSON.stringify({
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name,
          version: '1.0.0',
          dependencies,
          dist: { tarball: `${npm}${name}/-/${name}-1.0.0.tgz` },
        },
      },
    }));
  }));

  const plan = await resolveDeps({
    registry: createRegistryClient(dpm),
    rootDeps: { 'dpm-tar': '^1.0.0' },
    fallbackRegistry: createRegistryClient(npm),
  });

  expect(plan.errors).toEqual([]);
  expect(requests).toEqual([
    `${dpm}dpm-tar`, `${npm}dpm-tar`, `${dpm}nanotar`, `${npm}nanotar`,
  ]);
  expect(plan.resolved.get('node_modules/dpm-tar')).toMatchObject({ registry: npm, tarballUrl: `${npm}dpm-tar/-/dpm-tar-1.0.0.tgz` });
  expect(plan.resolved.get('node_modules/nanotar')).toMatchObject({ registry: npm, tarballUrl: `${npm}nanotar/-/nanotar-1.0.0.tgz` });
});

test.each([401, 500])('does not fall back when the direct registry returns %i', async (status) => {
  const dpm = 'https://registry.dusk.example/';
  const npm = 'https://registry.npmjs.org/';
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    requests.push(String(input));
    return new Response('failure', { status, statusText: 'Failure' });
  }));

  const plan = await resolveDeps({
    registry: createRegistryClient(dpm),
    rootDeps: { unavailable: '^1.0.0' },
    fallbackRegistry: createRegistryClient(npm),
  });

  expect(plan.errors).toHaveLength(1);
  expect(requests).toEqual([`${dpm}unavailable`]);
});

test.each(['', 'not json'])('does not fall back from a successful but invalid direct packument: %j', async (body) => {
  const dpm = 'https://registry.dusk.example/';
  const npm = 'https://registry.npmjs.org/';
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    requests.push(String(input));
    return new Response(body);
  }));

  const plan = await resolveDeps({
    registry: createRegistryClient(dpm),
    rootDeps: { unavailable: '^1.0.0' },
    fallbackRegistry: createRegistryClient(npm),
  });

  expect(plan.errors).toHaveLength(1);
  expect(requests).toEqual([`${dpm}unavailable`]);
});
