// Shared types for DPM.

export interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  type?: 'module' | 'commonjs';
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[];
  exports?: unknown;
  imports?: unknown;
  files?: string[];
  engines?: Record<string, string>;
}

export interface PackumentVersion {
  name: string;
  version: string;
  main?: string;
  bin?: string | Record<string, string>;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum?: string;
    integrity?: string;
    registry?: string;
  };
}

export interface Packument {
  name: string;
  versions: Record<string, PackumentVersion>;
  'dist-tags'?: Record<string, string>;
}

export interface LockfileEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  registry?: string;
  dev?: boolean;
  requires?: Record<string, string>;
  dependencies?: Record<string, LockfileEntry>;
}

export interface LockfileV3 {
  name?: string;
  version?: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, {
    name?: string;
    version?: string;
    resolved?: string;
    integrity?: string;
    registry?: string;
    dev?: boolean;
    bin?: string | Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>;
}

export interface ResolvedDep {
  name: string;
  version: string;
  tarballUrl: string;
  integrity?: string;
  registry?: string;
  shasum?: string;
  dependencies: Record<string, string>;
  isDev: boolean;
  isOptional?: boolean;
  isPeer?: boolean;
  // For URL/file/git specs, the original raw spec is preserved here.
  rawSpec?: string;
  // For file: specs, the absolute path to the local source dir on disk.
  localPath?: string;
  // Install location relative to project root (e.g. "node_modules/foo" or
  // "node_modules/vite/node_modules/rolldown"). When omitted, defaults to
  // "node_modules/<name>".
  installPath?: string;
  // For nested installs: the parent package's installPath, for transitive nesting.
  parentPath?: string;
}

export interface DpmOptions {
  cwd: string;
  registry: string;
  cacheDir: string;
  prefix: string;
  silent: boolean;
  saveDev: boolean;
  global: boolean;
}
