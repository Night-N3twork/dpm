import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCache, computeShasumIntegrity } from '../src/core/cache';

test('cache write/read roundtrip', () => {
  const tmpDir = path.join(os.tmpdir(), `dpm-cache-test-${Date.now()}`);
  const cache = createCache(tmpDir);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const integrity = computeShasumIntegrity(bytes);
  expect(cache.has(integrity)).toBe(false);
  cache.write(integrity, bytes);
  expect(cache.has(integrity)).toBe(true);
  const read = cache.read(integrity);
  expect(read).not.toBeNull();
  expect(Array.from(read!)).toEqual(Array.from(bytes));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cache miss returns null', () => {
  const tmpDir = path.join(os.tmpdir(), `dpm-cache-miss-${Date.now()}`);
  const cache = createCache(tmpDir);
  expect(cache.read('sha512-nonexistent')).toBeNull();
});
