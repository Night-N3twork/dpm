// `dpm install` — install dependencies.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRegistryClient } from '../core/registry.js';
import { resolveDeps } from '../core/resolver.js';
import { extractTarball } from '../core/tarball.js';
import { createCache, computeShasumIntegrity } from '../core/cache.js';
import { verifyIntegrity } from '../core/integrity.js';
import { readPackageJson, writePackageJson, mergeDep, allDeps } from '../core/manifest.js';
import { buildLockfile, readLockfile, writeLockfile } from '../core/lockfile.js';
import { createBinShims } from '../core/bin-shims.js';
import { runLifecycleScript, LIFECYCLE_ORDER } from '../core/scripts.js';
import { info, warn, error } from '../util/log.js';
import { defaultRegistry, defaultCacheDir } from '../util/env.js';
import { pAll } from '../util/p-all.js';
import type { ResolvedDep } from '../types.js';

const DEFAULT_CONCURRENCY = 16;

export interface InstallOptions {
  cwd: string;
  packages?: string[];   // names (with optional @version) to install
  saveDev?: boolean;
  registry?: string;
  cacheDir?: string;
  noScripts?: boolean;
  silent?: boolean;
}

const parsePackageSpec = (spec: string): { name: string; range: string } => {
  // Handle @scope/name@version
  if (spec.startsWith('@')) {
    const slashIdx = spec.indexOf('/');
    if (slashIdx === -1) return { name: spec, range: 'latest' };
    const atIdx = spec.indexOf('@', slashIdx);
    if (atIdx === -1) return { name: spec, range: 'latest' };
    return { name: spec.slice(0, atIdx), range: spec.slice(atIdx + 1) || 'latest' };
  }
  const atIdx = spec.indexOf('@');
  if (atIdx === -1) return { name: spec, range: 'latest' };
  return { name: spec.slice(0, atIdx), range: spec.slice(atIdx + 1) || 'latest' };
};

export const installCommand = async (opts: InstallOptions): Promise<number> => {
  const cwd = path.resolve(opts.cwd);
  const registryUrl = opts.registry ?? defaultRegistry();
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const noScripts = opts.noScripts ?? false;

  let pkg = readPackageJson(cwd);

  // Add packages if specified
  if (opts.packages && opts.packages.length > 0) {
    const isDev = opts.saveDev ?? false;
    for (const spec of opts.packages) {
      const { name, range } = parsePackageSpec(spec);
      // We don't know the version yet — fetch and resolve later. Use range or "*" as placeholder.
      mergeDep(pkg, name, range === 'latest' ? '*' : range, isDev);
    }
  }

  // Build root dep set
  const rootDeps = pkg.dependencies ?? {};
  const rootDevDeps = pkg.devDependencies ?? {};
  const rootOptDeps = pkg.optionalDependencies ?? {};
  const rootPeerDeps = pkg.peerDependencies ?? {};
  if (
    Object.keys(rootDeps).length === 0 &&
    Object.keys(rootDevDeps).length === 0 &&
    Object.keys(rootOptDeps).length === 0 &&
    Object.keys(rootPeerDeps).length === 0
  ) {
    info('Nothing to install.');
    return 0;
  }

  // Resolve
  info(`Resolving from ${registryUrl} ...`);
  const registry = createRegistryClient(registryUrl);
  const cache = createCache(cacheDir);
  const plan = await resolveDeps({
    registry,
    rootDeps,
    rootDevDeps,
    rootOptionalDeps: rootOptDeps,
    rootPeerDeps,
    rootDir: cwd,
    includeDev: true,
  });

  if (plan.warnings.length > 0) {
    for (const w of plan.warnings) warn(w);
  }
  if (plan.errors.length > 0) {
    for (const e of plan.errors) error(e);
    if (plan.resolved.size === 0) return 1;
    warn('Continuing with partial resolution.');
  }

  info(`Resolved ${plan.resolved.size} packages.`);

  // Update package.json with concrete versions for newly-added packages
  if (opts.packages && opts.packages.length > 0) {
    const isDev = opts.saveDev ?? false;
    for (const spec of opts.packages) {
      const { name } = parsePackageSpec(spec);
      // Look up the root-level entry by installPath
      const dep = plan.resolved.get(`node_modules/${name}`);
      if (dep) mergeDep(pkg, name, `^${dep.version}`, isDev);
    }
    writePackageJson(cwd, pkg);
  }

  // Install resolved packages in parallel (bounded concurrency)
  const nodeModulesDir = path.join(cwd, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) fs.mkdirSync(nodeModulesDir, { recursive: true });
  const binDir = path.join(nodeModulesDir, '.bin');

  // Resolve the absolute install dir for a ResolvedDep. installPath is relative
  // to project root (e.g. "node_modules/foo" or "node_modules/vite/node_modules/rolldown").
  const absInstallDir = (dep: ResolvedDep): string => {
    const ip = dep.installPath ?? `node_modules/${dep.name}`;
    return path.join(cwd, ip);
  };

  const allDeps = [...plan.resolved.values()];
  const toInstall = allDeps.filter((dep) => {
    const installPath = absInstallDir(dep);
    if (fs.existsSync(path.join(installPath, 'package.json'))) {
      info(`  ${dep.name}@${dep.version} (already installed)`);
      return false;
    }
    return true;
  });

  const copyDirRecursive = (src: string, dst: string): void => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const srcP = path.join(src, entry.name);
      const dstP = path.join(dst, entry.name);
      if (entry.isDirectory()) copyDirRecursive(srcP, dstP);
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs.readlinkSync(srcP);
          fs.symlinkSync(target, dstP);
        } catch { /* */ }
      } else {
        try { fs.copyFileSync(srcP, dstP); } catch { /* */ }
      }
    }
  };

  await pAll(toInstall, DEFAULT_CONCURRENCY, async (dep: ResolvedDep) => {
    const installPath = absInstallDir(dep);
    info(`  ${dep.name}@${dep.version}`);

    // Only create .bin shims for top-level installs (npm behavior).
    const isTopLevel = !dep.installPath || !dep.installPath.includes('/node_modules/');

    // file: spec — copy from local path
    if (dep.localPath) {
      if (!fs.existsSync(dep.localPath)) {
        const msg = `file: source not found for ${dep.name}: ${dep.localPath}`;
        if (dep.isOptional) warn(msg);
        else error(msg);
        return;
      }
      const srcPkgPath = path.join(dep.localPath, 'package.json');
      if (fs.existsSync(srcPkgPath)) {
        try {
          const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, 'utf8')) as { version?: string; bin?: string | Record<string, string> };
          if (srcPkg.version) dep.version = srcPkg.version;
          fs.mkdirSync(installPath, { recursive: true });
          copyDirRecursive(dep.localPath, installPath);
          if (srcPkg.bin && isTopLevel) createBinShims(binDir, dep.name, installPath, srcPkg.bin);
        } catch (e) {
          const msg = `Failed to install file: dep ${dep.name}: ${(e as Error).message}`;
          if (dep.isOptional) warn(msg);
          else error(msg);
        }
      } else {
        const msg = `file: source has no package.json: ${dep.localPath}`;
        if (dep.isOptional) warn(msg);
        else error(msg);
      }
      return;
    }

    // Fetch tarball (use cache if available)
    let tarballBytes: Uint8Array | null = null;
    if (dep.integrity && cache.has(dep.integrity)) {
      tarballBytes = cache.read(dep.integrity);
    }
    if (!tarballBytes) {
      try {
        tarballBytes = await registry.getTarball(dep.tarballUrl);
      } catch (e) {
        const msg = `Fetch failed for ${dep.name}@${dep.version}: ${(e as Error).message}`;
        if (dep.isOptional) warn(msg);
        else error(msg);
        return;
      }
      const integ = dep.integrity ?? computeShasumIntegrity(tarballBytes);
      cache.write(integ, tarballBytes);
      if (dep.integrity && !verifyIntegrity(tarballBytes, dep.integrity)) {
        const msg = `Integrity check failed for ${dep.name}@${dep.version}`;
        if (dep.isOptional) warn(msg);
        else error(msg);
        return;
      }
    }

    // Extract
    fs.mkdirSync(installPath, { recursive: true });
    try {
      await extractTarball(tarballBytes, installPath, { stripComponents: 1 });
    } catch (e) {
      const msg = `Extract failed for ${dep.name}@${dep.version}: ${(e as Error).message}`;
      if (dep.isOptional) warn(msg);
      else error(msg);
      // Remove the half-created install dir so we don't leave a stub package.json behind
      try { fs.rmSync(installPath, { recursive: true, force: true }); } catch { /* */ }
      return;
    }
    // Verify that extraction actually produced a valid package.json
    const pkgJsonPath = path.join(installPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath) || fs.statSync(pkgJsonPath).size === 0) {
      const msg = `Empty/missing package.json after extract for ${dep.name}@${dep.version}`;
      if (dep.isOptional) warn(msg);
      else error(msg);
      try { fs.rmSync(installPath, { recursive: true, force: true }); } catch { /* */ }
      return;
    }

    // Read package.json, create bin shims (top-level only)
    if (isTopLevel) {
      try {
        const subPkg = readPackageJson(installPath);
        if (subPkg.bin) createBinShims(binDir, dep.name, installPath, subPkg.bin);
      } catch { /* */ }
    }
  });

  // Run lifecycle scripts (for ALL installed packages, in any-order — npm
  // technically runs them post-order; for a first pass we just iterate).
  if (!noScripts) {
    for (const dep of plan.resolved.values()) {
      const installPath = absInstallDir(dep);
      let subPkg;
      try {
        subPkg = readPackageJson(installPath);
      } catch (e) {
        warn(`  ${dep.name}: bad package.json, skipping lifecycle: ${(e as Error).message}`);
        continue;
      }
      if (!subPkg.scripts) continue;
      for (const phase of ['preinstall', 'install', 'postinstall']) {
        if (subPkg.scripts[phase]) {
          info(`  running ${phase} for ${dep.name}`);
          const status = runLifecycleScript(subPkg, phase, installPath, cwd);
          if (status !== 0) warn(`  ${dep.name}: ${phase} exited ${status}`);
        }
      }
    }
    // Run root package's own scripts
    for (const phase of ['preinstall', 'install', 'postinstall', 'prepare']) {
      if (pkg.scripts?.[phase]) {
        info(`running ${phase} for root`);
        runLifecycleScript(pkg, phase, cwd, cwd);
      }
    }
  }

  // Write lockfile
  const lockfile = buildLockfile(
    pkg.name, pkg.version,
    pkg.dependencies ?? {}, pkg.devDependencies ?? {},
    plan.resolved,
  );
  writeLockfile(cwd, lockfile);

  info(`Done. Installed ${plan.resolved.size} packages.`);
  return 0;
};

void LIFECYCLE_ORDER;
