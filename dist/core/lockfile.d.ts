import type { LockfileV3, ResolvedDep } from '../types.js';
export declare const readLockfile: (cwd: string) => LockfileV3 | null;
export declare const writeLockfile: (cwd: string, lockfile: LockfileV3) => void;
export declare const buildLockfile: (pkgName: string | undefined, pkgVersion: string | undefined, rootDeps: Record<string, string>, rootDevDeps: Record<string, string>, resolved: Map<string, ResolvedDep>) => LockfileV3;
//# sourceMappingURL=lockfile.d.ts.map