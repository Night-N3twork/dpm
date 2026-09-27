import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));

function findChromiumExecutable({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  exists = existsSync,
} = {}) {
  if (env.CHROMIUM_PATH) {
    if (exists(env.CHROMIUM_PATH)) return env.CHROMIUM_PATH;
    throw new Error(`CHROMIUM_PATH does not point to a Chromium executable: ${env.CHROMIUM_PATH}`);
  }

  let candidates;
  if (platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    ];
  } else if (platform === 'win32') {
    const programFiles = [env.PROGRAMFILES, env.ProgramFiles, env['PROGRAMFILES(X86)'], env['ProgramFiles(x86)']].filter(Boolean);
    candidates = [
      ...programFiles.flatMap((directory) => [
        win32.join(directory, 'Google/Chrome/Application/chrome.exe'),
        win32.join(directory, 'Chromium/Application/chrome.exe'),
        win32.join(directory, 'Microsoft/Edge/Application/msedge.exe'),
      ]),
      ...(env.LOCALAPPDATA ? [
        win32.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
        win32.join(env.LOCALAPPDATA, 'Chromium/Application/chrome.exe'),
        win32.join(env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
      ] : []),
    ];
  } else {
    candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
    ];
  }

  const executable = candidates.find(exists);
  if (executable) return executable;
  throw new Error(`Chromium was not found on ${platform}. Set CHROMIUM_PATH to an installed executable. Searched: ${candidates.join(', ')}`);
}

test('Chromium discovery honors overrides and platform installation paths', () => {
  const existing = new Set([
    '/custom/chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  ]);
  const options = { exists: (path) => existing.has(path) };

  assert.equal(findChromiumExecutable({ ...options, env: { CHROMIUM_PATH: '/custom/chrome' }, platform: 'linux', home: '/home/test' }), '/custom/chrome');
  assert.equal(findChromiumExecutable({ ...options, env: {}, platform: 'darwin', home: '/Users/test' }), '/Applications/Chromium.app/Contents/MacOS/Chromium');
  assert.equal(findChromiumExecutable({
    ...options,
    env: { PROGRAMFILES: String.raw`C:\Program Files` },
    platform: 'win32',
    home: String.raw`C:\Users\test`,
  }), String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`);
});

test('packed web package initializes and executes in Chromium', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dpm-browser-package-'));
  let browser;
  let server;

  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
    }));
    const consumer = join(temporary, 'consumer');
    execFileSync('npm', [
      'install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund',
      join(temporary, packed.filename),
    ], { stdio: 'pipe' });

    const dist = join(consumer, 'node_modules/@nightnetwork/dpm/dist');
    const requests = [];
    server = createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      requests.push(pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><link rel="icon" href="data:"><title>DPM browser test</title>');
        return;
      }
      const assets = {
        '/dpm_wasm.js': ['dpm_wasm.js', 'text/javascript; charset=utf-8'],
        '/dpm_wasm_bg.wasm': ['dpm_wasm_bg.wasm', 'application/wasm'],
      };
      const asset = assets[pathname];
      if (!asset) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': asset[1] });
      response.end(readFileSync(join(dist, asset[0])));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const executablePath = findChromiumExecutable();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    });
    const page = await browser.newPage();
    const errors = [];
    let wasmContentType;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', (response) => {
      if (!response.ok()) errors.push(`response: ${response.status()} ${response.url()}`);
      if (new URL(response.url()).pathname === '/dpm_wasm_bg.wasm') {
        wasmContentType = response.headers()['content-type'];
      }
    });

    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async () => {
      const { default: init, execute } = await import('/dpm_wasm.js');
      await init();
      return execute(['--help'], { exists: async () => false }, '/project', {});
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.equal(result.stderr, '');
    assert.match(wasmContentType, /^application\/wasm(?:;|$)/);
    assert.deepEqual(errors, [], `browser requests: ${requests.join(', ')}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    rmSync(temporary, { recursive: true, force: true });
  }
});
