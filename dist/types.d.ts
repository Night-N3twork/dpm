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
    optionalDependencies?: Record<string, string>;
    dist: {
        tarball: string;
        shasum?: string;
        integrity?: string;
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
    shasum?: string;
    dependencies: Record<string, string>;
    isDev: boolean;
    isOptional?: boolean;
    isPeer?: boolean;
    rawSpec?: string;
    localPath?: string;
    installPath?: string;
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
//# sourceMappingURL=types.d.ts.map