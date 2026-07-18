// Registry client — fetches packument and tarballs from registry.
const fetchBuffer = async (url, accept) => {
    const opts = {};
    if (accept)
        opts.headers = { 'Accept': accept };
    const res = await fetch(url, opts);
    if (!res.ok) {
        throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
};
const fetchJson = async (url, accept) => {
    const opts = {};
    if (accept)
        opts.headers = { 'Accept': accept };
    const res = await fetch(url, opts);
    if (!res.ok) {
        throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.json();
};
export const createRegistryClient = (registryUrl) => {
    const base = registryUrl.replace(/\/+$/, '');
    return {
        async getPackument(name) {
            const url = `${base}/${encodeURIComponent(name).replace(/%2[fF]/g, '/')}`;
            return fetchJson(url, 'application/vnd.npm.install-v1+json');
        },
        async getTarball(url) {
            return fetchBuffer(url);
        },
    };
};
//# sourceMappingURL=registry.js.map