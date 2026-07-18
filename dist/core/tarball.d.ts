export interface TarEntry {
    name: string;
    size: number;
    type: 'file' | 'dir' | 'symlink' | 'longname' | 'longlink' | 'other';
    mode: number;
    body: Uint8Array;
}
export declare const parseTar: (bytes: Uint8Array) => TarEntry[];
export declare const extractTarball: (tarballBytes: Uint8Array, destDir: string, options?: {
    stripComponents?: number;
}) => Promise<void>;
//# sourceMappingURL=tarball.d.ts.map