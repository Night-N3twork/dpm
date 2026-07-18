export interface Cache {
    has(integrity: string): boolean;
    read(integrity: string): Uint8Array | null;
    write(integrity: string, bytes: Uint8Array): void;
    pathFor(integrity: string): string;
}
declare const hashHex: (bytes: Uint8Array, alg: string) => string;
export declare const createCache: (cacheDir: string) => Cache;
export declare const computeShasumIntegrity: (bytes: Uint8Array, algorithm?: "sha1" | "sha256" | "sha512") => string;
export { hashHex };
//# sourceMappingURL=cache.d.ts.map