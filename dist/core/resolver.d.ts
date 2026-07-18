import type { ResolvedDep } from '../types.js';
import type { RegistryClient } from './registry.js';
export interface ResolveOptions {
    registry: RegistryClient;
    rootDeps: Record<string, string>;
    rootDevDeps?: Record<string, string>;
    rootOptionalDeps?: Record<string, string>;
    rootPeerDeps?: Record<string, string>;
    rootDir?: string;
    includeDev?: boolean;
    concurrency?: number;
}
export interface InstallPlan {
    resolved: Map<string, ResolvedDep>;
    errors: string[];
    warnings: string[];
}
export declare const resolveDeps: (opts: ResolveOptions) => Promise<InstallPlan>;
//# sourceMappingURL=resolver.d.ts.map