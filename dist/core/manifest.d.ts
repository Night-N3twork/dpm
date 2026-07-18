import type { PackageJson } from '../types.js';
export declare const readPackageJson: (cwd: string) => PackageJson;
export declare const writePackageJson: (cwd: string, pkg: PackageJson) => void;
export declare const findPackageRoot: (cwd: string) => string;
export declare const mergeDep: (pkg: PackageJson, name: string, version: string, dev: boolean) => void;
export declare const removeDep: (pkg: PackageJson, name: string) => void;
export declare const allDeps: (pkg: PackageJson, includeDev?: boolean) => Record<string, string>;
//# sourceMappingURL=manifest.d.ts.map