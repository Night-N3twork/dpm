import { afterEach, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../src/core/resolver', () => ({
  resolveDeps: vi.fn(async () => ({
    resolved: new Map(),
    errors: [],
    fatalErrors: ['Peer dependency conflict: plugin requires host@^2.0.0, but root has 1.0.0'],
    warnings: [],
  })),
}));

import { installCommand } from '../src/commands/install';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('does not write project files when peer resolution has a fatal conflict', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dpm-peer-install-'));
  temporary.push(cwd);
  const manifestPath = path.join(cwd, 'package.json');
  const originalManifest = JSON.stringify({ name: 'project', version: '1.0.0' });
  fs.writeFileSync(manifestPath, originalManifest);

  const status = await installCommand({ cwd, packages: ['added'] });

  expect(status).toBe(1);
  expect(fs.readFileSync(manifestPath, 'utf8')).toBe(originalManifest);
  expect(fs.existsSync(path.join(cwd, 'node_modules'))).toBe(false);
  expect(fs.existsSync(path.join(cwd, 'package-lock.json'))).toBe(false);
});
