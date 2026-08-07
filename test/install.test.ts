import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hasValidPackageJson } from '../src/core/manifest';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpm-install-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('accepts a readable package.json without relying on stat size metadata', () => {
  const packageDir = makeTempDir();
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));

  expect(hasValidPackageJson(packageDir)).toBe(true);
});

test('rejects a missing or malformed package.json', () => {
  const packageDir = makeTempDir();

  expect(hasValidPackageJson(packageDir)).toBe(false);
  fs.writeFileSync(path.join(packageDir, 'package.json'), '{');
  expect(hasValidPackageJson(packageDir)).toBe(false);
});
