export interface InstallOptions {
    cwd: string;
    packages?: string[];
    saveDev?: boolean;
    registry?: string;
    cacheDir?: string;
    noScripts?: boolean;
    silent?: boolean;
}
export declare const installCommand: (opts: InstallOptions) => Promise<number>;
//# sourceMappingURL=install.d.ts.map