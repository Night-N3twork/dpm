import type { Packument } from '../types.js';
export interface RegistryClient {
    getPackument(name: string): Promise<Packument>;
    getTarball(url: string): Promise<Uint8Array>;
}
export declare const createRegistryClient: (registryUrl: string) => RegistryClient;
//# sourceMappingURL=registry.d.ts.map