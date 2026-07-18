export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    build: string[];
    raw: string;
}
export declare const parse: (version: string) => SemVer | null;
export declare const valid: (version: string) => boolean;
export declare const compare: (a: SemVer | string, b: SemVer | string) => -1 | 0 | 1;
export declare const gt: (a: SemVer | string, b: SemVer | string) => boolean;
export declare const gte: (a: SemVer | string, b: SemVer | string) => boolean;
export declare const lt: (a: SemVer | string, b: SemVer | string) => boolean;
export declare const lte: (a: SemVer | string, b: SemVer | string) => boolean;
export declare const eq: (a: SemVer | string, b: SemVer | string) => boolean;
export declare const satisfies: (version: string, range: string, opts?: {
    includePrerelease?: boolean;
}) => boolean;
export declare const maxSatisfying: (versions: string[], range: string) => string | null;
export declare const minSatisfying: (versions: string[], range: string) => string | null;
//# sourceMappingURL=index.d.ts.map