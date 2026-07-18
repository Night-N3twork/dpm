import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractTarball, parseTar } from '../src/core/tarball';

test('parseTar parses a single-file ustar archive', () => {
  // Build a simple tar header + body in-memory
  const header = Buffer.alloc(512);
  header.write('package/hello.txt', 0, 'utf8');
  header.write('0000644 ', 100, 'utf8');
  header.write('0001750 ', 108, 'utf8');
  header.write('0001750 ', 116, 'utf8');
  header.write('00000000014 ', 124, 'utf8');
  header.write('14000000000 ', 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header.write('0', 156, 'utf8');
  header.write('ustar', 257, 'utf8');
  header.write('00', 263, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  const chksumStr = sum.toString(8).padStart(6, '0') + '\0 ';
  header.write(chksumStr, 148, 'utf8');
  const body = Buffer.from('hello world\n');
  const padded = Buffer.alloc(512);
  body.copy(padded, 0);
  const tar = Buffer.concat([header, padded, Buffer.alloc(1024)]);

  const entries = parseTar(new Uint8Array(tar.buffer, tar.byteOffset, tar.byteLength));
  expect(entries.length).toBe(1);
  expect(entries[0]!.name).toBe('package/hello.txt');
  expect(entries[0]!.size).toBe(12);
  expect(entries[0]!.type).toBe('file');
});

test('extractTarball extracts the fixture tarball', async () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'tiny.tgz');
  const bytes = new Uint8Array(fs.readFileSync(fixturePath));
  const tmpDir = path.join(os.tmpdir(), `dpm-tar-test-${Date.now()}`);
  await extractTarball(bytes, tmpDir, { stripComponents: 1 });
  const helloPath = path.join(tmpDir, 'hello.txt');
  expect(fs.existsSync(helloPath)).toBe(true);
  expect(fs.readFileSync(helloPath, 'utf8')).toBe('hello world\n');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
