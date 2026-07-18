import type { PackageJson } from '../types.js';
export declare const LIFECYCLE_ORDER: string[];
export declare const runLifecycleScript: (pkg: PackageJson, scriptName: string, pkgDir: string, rootDir: string) => number;
export declare const runLifecyclePhase: (pkg: PackageJson, phase: string, pkgDir: string, rootDir: string) => number;
//# sourceMappingURL=scripts.d.ts.map