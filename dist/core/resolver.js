// Dependency resolver — concurrent BFS with hoisting + nested fallback (npm-compat).
//
// Strategy:
//   1. Walk the dep graph in BFS waves.
//   2. For each transitive dep, try to satisfy with an already-hoisted version
//      (starts at root node_modules/, walks up the parent chain).
//   3. If no compatible hoisted version exists, install at the highest level
//      that has no conflict. For the root project's own deps, that's always
//      node_modules/<name>.
//   4. If a transitive dep's range is incompatible with the hoisted version,
//      install it nested under the parent: <parent>/node_modules/<name>.
//
// Spec types handled:
//   - registry semver ranges (^1.2.3, ~1.0.0, >=1, etc.) — fetch packument
//   - URL tarballs (https://.../foo.tgz, http://...) — synthesize ResolvedDep directly
//   - file: deps (file:./pkg, file:../pkg) — synthesize with localPath
//   - dist-tags (latest, next, etc.) — resolved via packument
//
// Spec types NOT handled (skipped with warning):
//   - git deps (git+ssh://, github:user/repo)
//   - workspace: protocol
//
// optionalDependencies and peerDependencies are walked the same as deps,
// but flagged. Resolution failures for optional deps are warnings, not errors.
import * as path from 'node:path';
import * as semver from '../semver/index.js';
const classifySpec = (rawSpec, rootDir) => {
    const s = rawSpec.trim();
    if (s === '' || s === '*' || s === 'latest')
        return { kind: 'registry', range: s || 'latest' };
    if (/^(npm:)/i.test(s))
        return { kind: 'registry', range: s.slice(4) };
    if (/^https?:\/\//i.test(s))
        return { kind: 'url', url: s };
    if (/^file:/i.test(s)) {
        const p = s.slice(5);
        const resolved = rootDir ? path.resolve(rootDir, p) : path.resolve(p);
        return { kind: 'file', filePath: resolved };
    }
    if (/^(git\+|git:|github:|gitlab:|bitbucket:)/i.test(s)) {
        return { kind: 'unsupported', reason: 'git deps not supported' };
    }
    if (/^workspace:/i.test(s)) {
        return { kind: 'unsupported', reason: 'workspace: protocol not supported' };
    }
    return { kind: 'registry', range: s };
};
const resolveOneVersion = (packument, range) => {
    const versions = Object.keys(packument.versions);
    const distTag = packument['dist-tags']?.[range];
    if (distTag)
        return distTag;
    if (semver.valid(range))
        return range;
    return semver.maxSatisfying(versions, range);
};
const rootInstallPath = (name) => `node_modules/${name}`;
const nestedInstallPath = (parentPath, name) => `${parentPath}/node_modules/${name}`;
// Walk up the parent chain to find an already-hoisted version of `name` that
// satisfies `range`. Returns the installPath of the satisfying entry, or null.
const findCompatibleAncestor = (resolved, parentPath, name, range) => {
    // Build candidate paths: walk up from parent, plus root.
    const candidates = [];
    let cur = parentPath;
    while (cur) {
        candidates.push(`${cur}/node_modules/${name}`);
        // Strip one /node_modules/<pkg> level
        const idx = cur.lastIndexOf('/node_modules/');
        if (idx === -1)
            break;
        cur = cur.slice(0, idx);
        if (cur === '' || cur === 'node_modules')
            break;
    }
    candidates.push(rootInstallPath(name));
    for (const cp of candidates) {
        const dep = resolved.get(cp);
        if (dep && semver.satisfies(dep.version, range))
            return { installPath: cp, dep };
    }
    return null;
};
// Check whether a name is already taken at the root level by a DIFFERENT version
// (that doesn't satisfy the requested range). If so, we need to nest.
const rootHasConflict = (resolved, name, range) => {
    const rootPath = rootInstallPath(name);
    const existing = resolved.get(rootPath);
    if (!existing)
        return false;
    return !semver.satisfies(existing.version, range);
};
const synthesizeUrlDep = (name, url, isDev, isOptional, isPeer, installPath) => {
    const m = /[^/]+?-(\d[^/]*?)\.t(?:ar\.)?gz$/.exec(url);
    const version = m?.[1] ?? '0.0.0-url';
    return {
        name,
        version,
        tarballUrl: url,
        dependencies: {},
        isDev,
        ...(isOptional ? { isOptional: true } : {}),
        ...(isPeer ? { isPeer: true } : {}),
        rawSpec: url,
        installPath,
    };
};
const synthesizeFileDep = (name, absPath, isDev, isOptional, isPeer, installPath) => {
    return {
        name,
        version: '0.0.0-file',
        tarballUrl: '',
        dependencies: {},
        isDev,
        ...(isOptional ? { isOptional: true } : {}),
        ...(isPeer ? { isPeer: true } : {}),
        rawSpec: `file:${absPath}`,
        localPath: absPath,
        installPath,
    };
};
export const resolveDeps = async (opts) => {
    const resolved = new Map();
    const errors = [];
    const warnings = [];
    const packumentCache = new Map();
    const getPackument = (name) => {
        let existing = packumentCache.get(name);
        if (existing)
            return existing;
        existing = opts.registry.getPackument(name).catch((e) => {
            errors.push(`Failed to fetch ${name}: ${e.message}`);
            return null;
        });
        packumentCache.set(name, existing);
        return existing;
    };
    let frontier = [];
    for (const [n, r] of Object.entries(opts.rootDeps)) {
        frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: false, isPeer: false, parentPath: undefined });
    }
    if (opts.includeDev !== false) {
        for (const [n, r] of Object.entries(opts.rootDevDeps ?? {})) {
            frontier.push({ name: n, rawSpec: r, isDev: true, isOptional: false, isPeer: false, parentPath: undefined });
        }
    }
    for (const [n, r] of Object.entries(opts.rootOptionalDeps ?? {})) {
        frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: true, isPeer: false, parentPath: undefined });
    }
    for (const [n, r] of Object.entries(opts.rootPeerDeps ?? {})) {
        frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: false, isPeer: true, parentPath: undefined });
    }
    const enqueueSubDeps = (v, parentPath, sink) => {
        for (const [dn, dr] of Object.entries(v.dependencies ?? {})) {
            sink.push({ name: dn, rawSpec: dr, isDev: false, isOptional: false, isPeer: false, parentPath });
        }
        for (const [dn, dr] of Object.entries(v.optionalDependencies ?? {})) {
            sink.push({ name: dn, rawSpec: dr, isDev: false, isOptional: true, isPeer: false, parentPath });
        }
        for (const [dn, dr] of Object.entries(v.peerDependencies ?? {})) {
            sink.push({ name: dn, rawSpec: dr, isDev: false, isOptional: false, isPeer: true, parentPath });
        }
    };
    while (frontier.length > 0) {
        const registryItems = [];
        for (const item of frontier) {
            // Reuse an ancestor-hoisted version if compatible.
            const hit = findCompatibleAncestor(resolved, item.parentPath, item.name, item.rawSpec);
            if (hit)
                continue;
            const spec = classifySpec(item.rawSpec, opts.rootDir);
            if (spec.kind === 'url') {
                const installPath = item.parentPath && rootHasConflict(resolved, item.name, item.rawSpec)
                    ? nestedInstallPath(item.parentPath, item.name)
                    : rootInstallPath(item.name);
                if (resolved.has(installPath))
                    continue;
                resolved.set(installPath, synthesizeUrlDep(item.name, spec.url, item.isDev, item.isOptional, item.isPeer, installPath));
                continue;
            }
            if (spec.kind === 'file') {
                const installPath = item.parentPath && rootHasConflict(resolved, item.name, item.rawSpec)
                    ? nestedInstallPath(item.parentPath, item.name)
                    : rootInstallPath(item.name);
                if (resolved.has(installPath))
                    continue;
                resolved.set(installPath, synthesizeFileDep(item.name, spec.filePath, item.isDev, item.isOptional, item.isPeer, installPath));
                continue;
            }
            if (spec.kind === 'unsupported') {
                warnings.push(`Skipping ${item.name}@${item.rawSpec}: ${spec.reason}`);
                continue;
            }
            registryItems.push(item);
        }
        // Group registry items by name within this wave (one fetch per name, but
        // we'll create per-conflict entries below).
        const byName = new Map();
        for (const item of registryItems) {
            const list = byName.get(item.name);
            if (list)
                list.push(item);
            else
                byName.set(item.name, [item]);
        }
        const names = [...byName.keys()];
        const packuments = await Promise.all(names.map((n) => getPackument(n)));
        const nextFrontier = [];
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const packument = packuments[i];
            const requests = byName.get(name);
            if (!packument) {
                for (const req of requests) {
                    if (req.isOptional) {
                        warnings.push(`Skipping optional ${req.name}@${req.rawSpec}: packument unavailable`);
                    }
                }
                continue;
            }
            // Process each request individually so conflicting versions get nested.
            for (const req of requests) {
                // Re-check ancestor compat in case earlier reqs in this wave hoisted something.
                const hit = findCompatibleAncestor(resolved, req.parentPath, req.name, req.rawSpec);
                if (hit)
                    continue;
                const candidate = resolveOneVersion(packument, req.rawSpec);
                if (!candidate) {
                    const msg = `Cannot resolve ${req.name}@${req.rawSpec}: no matching version`;
                    if (req.isOptional)
                        warnings.push(msg);
                    else
                        errors.push(msg);
                    continue;
                }
                const v = packument.versions[candidate];
                if (!v) {
                    const msg = `Version ${candidate} not found in packument for ${req.name}`;
                    if (req.isOptional)
                        warnings.push(msg);
                    else
                        errors.push(msg);
                    continue;
                }
                // Pick install path. If root slot for this name is taken by an incompatible
                // version AND we have a parent to nest under, nest. Otherwise install at root.
                let installPath = rootInstallPath(req.name);
                const rootSlot = resolved.get(installPath);
                if (rootSlot && rootSlot.version !== candidate) {
                    // Conflict. If we can nest under parent, do so.
                    if (req.parentPath) {
                        installPath = nestedInstallPath(req.parentPath, req.name);
                        if (resolved.has(installPath))
                            continue;
                    }
                    else {
                        // No parent (this is a root dep) and root slot has a different version.
                        // Pick the higher version for the root slot (closest to npm's behavior
                        // when two root entries collide — shouldn't normally happen).
                        if (semver.gt(candidate, rootSlot.version)) {
                            // Replace root entry with the higher version.
                            resolved.set(installPath, {
                                name: req.name,
                                version: candidate,
                                tarballUrl: v.dist.tarball,
                                ...(v.dist.integrity !== undefined ? { integrity: v.dist.integrity } : {}),
                                ...(v.dist.shasum !== undefined ? { shasum: v.dist.shasum } : {}),
                                dependencies: v.dependencies ?? {},
                                isDev: req.isDev,
                                ...(req.isOptional ? { isOptional: true } : {}),
                                ...(req.isPeer ? { isPeer: true } : {}),
                                installPath,
                            });
                            enqueueSubDeps(v, installPath, nextFrontier);
                        }
                        continue;
                    }
                }
                else if (rootSlot && rootSlot.version === candidate) {
                    // Same version already at root — nothing to do.
                    continue;
                }
                resolved.set(installPath, {
                    name: req.name,
                    version: candidate,
                    tarballUrl: v.dist.tarball,
                    ...(v.dist.integrity !== undefined ? { integrity: v.dist.integrity } : {}),
                    ...(v.dist.shasum !== undefined ? { shasum: v.dist.shasum } : {}),
                    dependencies: v.dependencies ?? {},
                    isDev: req.isDev,
                    ...(req.isOptional ? { isOptional: true } : {}),
                    ...(req.isPeer ? { isPeer: true } : {}),
                    installPath,
                    ...(req.parentPath !== undefined ? { parentPath: req.parentPath } : {}),
                });
                enqueueSubDeps(v, installPath, nextFrontier);
            }
        }
        frontier = nextFrontier;
    }
    // ---- Hoist pass ----
    //
    // After the BFS, some packages got nested under their immediate parent even
    // though they could safely live higher up (or be shared with sibling nested
    // copies of the exact same version). Walk the plan and hoist each nested
    // entry to the highest possible ancestor where its presence wouldn't conflict
    // with any already-resolved version.
    hoistPass(resolved);
    return { resolved, errors, warnings };
};
// Hoist nested entries to the highest position where they don't conflict.
//
// Strategy:
//   1. Group entries by name.
//   2. If only ONE version of a name exists across all locations and the root
//      slot is empty, hoist everything to root.
//   3. If multiple versions exist:
//      - For each version, find the deepest common parent of its consumers
//        and hoist all copies of that version to a single location at that
//        parent. Then optionally promote ONE version to the root slot
//        (typically the most-referenced one).
const hoistPass = (resolved) => {
    const byName = new Map();
    for (const installPath of resolved.keys()) {
        const dep = resolved.get(installPath);
        const list = byName.get(dep.name);
        if (list)
            list.push(installPath);
        else
            byName.set(dep.name, [installPath]);
    }
    const targetInstallPath = (ancestor, name) => {
        if (ancestor === '' || ancestor === 'node_modules')
            return `node_modules/${name}`;
        return `${ancestor}/node_modules/${name}`;
    };
    for (const [name, paths] of byName) {
        if (paths.length < 2)
            continue;
        // Group paths by version
        const byVersion = new Map();
        for (const p of paths) {
            const v = resolved.get(p).version;
            const list = byVersion.get(v);
            if (list)
                list.push(p);
            else
                byVersion.set(v, [p]);
        }
        const rootPath = `node_modules/${name}`;
        const versions = [...byVersion.keys()];
        if (versions.length === 1 && !resolved.has(rootPath)) {
            // Single version, no root slot → hoist everything to root.
            const allPaths = paths;
            const canonical = resolved.get(allPaths[0]);
            const newDep = { ...canonical, installPath: rootPath };
            delete newDep.parentPath;
            resolved.set(rootPath, newDep);
            for (const p of allPaths) {
                if (p !== rootPath)
                    resolved.delete(p);
            }
            continue;
        }
        // Multiple versions OR root slot already taken: for each version, hoist its
        // copies to a deepest-common-ancestor location.
        for (const [version, vPaths] of byVersion) {
            if (vPaths.length < 2)
                continue;
            const lca = longestCommonInstallAncestor(vPaths);
            const target = targetInstallPath(lca, name);
            if (vPaths.includes(target)) {
                // Already at the LCA — just delete the duplicates.
                for (const p of vPaths) {
                    if (p !== target)
                        resolved.delete(p);
                }
                continue;
            }
            // Make sure we don't conflict with an existing entry at target.
            const existing = resolved.get(target);
            if (existing && existing.version !== version)
                continue;
            // Make sure no closer ancestor between LCA and root has a conflicting entry.
            // (e.g. moving from foo/bar/node_modules/X up to foo/node_modules/X — but
            // foo's own X is different.) Walk up.
            let safe = true;
            let walk = lca;
            while (walk !== '' && walk !== 'node_modules') {
                const ancestorTarget = targetInstallPath(walk, name);
                const e = resolved.get(ancestorTarget);
                if (e && e.version !== version && ancestorTarget !== target) {
                    safe = false;
                    break;
                }
                const idx = walk.lastIndexOf('/node_modules/');
                if (idx === -1)
                    break;
                walk = walk.slice(0, idx);
            }
            if (!safe)
                continue;
            const canonical = resolved.get(vPaths[0]);
            const newDep = { ...canonical, installPath: target };
            if (lca === '' || lca === 'node_modules') {
                delete newDep.parentPath;
            }
            else {
                newDep.parentPath = lca;
            }
            resolved.set(target, newDep);
            for (const p of vPaths) {
                if (p !== target)
                    resolved.delete(p);
            }
        }
        // If there's STILL no entry at the root slot for this name, promote the
        // most-referenced version to root.
        if (!resolved.has(rootPath)) {
            const stillByVersion = new Map();
            for (const p of resolved.keys()) {
                const d = resolved.get(p);
                if (d.name !== name)
                    continue;
                const list = stillByVersion.get(d.version);
                if (list)
                    list.push(p);
                else
                    stillByVersion.set(d.version, [p]);
            }
            let bestVersion = null;
            let bestCount = 0;
            for (const [v, ps] of stillByVersion) {
                if (ps.length > bestCount) {
                    bestVersion = v;
                    bestCount = ps.length;
                }
            }
            if (bestVersion !== null && stillByVersion.size === 1) {
                // Only safe to promote if only one version remains (no conflict at root)
                const ps = stillByVersion.get(bestVersion);
                const canonical = resolved.get(ps[0]);
                const newDep = { ...canonical, installPath: rootPath };
                delete newDep.parentPath;
                resolved.set(rootPath, newDep);
                for (const p of ps) {
                    if (p !== rootPath)
                        resolved.delete(p);
                }
            }
        }
    }
    // ---- Pass 2: single-path lift ----
    //
    // For each nested entry that's the *only* copy of its version for that name,
    // try to lift it up the parent chain as far as possible without conflict.
    // This catches cases where the BFS nested a transitive dep deeply under
    // readdirp/node_modules/picomatch when it could just go to
    // vite-plugin-static-copy/node_modules/picomatch.
    let anyMoved = true;
    let safetyIters = 0;
    while (anyMoved && safetyIters++ < 32) {
        anyMoved = false;
        for (const installPath of [...resolved.keys()]) {
            const dep = resolved.get(installPath);
            if (!dep)
                continue;
            // Only consider nested entries (have "/node_modules/" somewhere besides leading)
            const segments = installPath.split('/node_modules/');
            if (segments.length < 3)
                continue; // top-level is "node_modules/X" → 2 segments
            // Try to drop the deepest non-leaf segment and check if no conflict at the lifted location.
            // segments looks like: ['node_modules', 'parentPkg', 'name'] after split
            // For "node_modules/A/node_modules/B/node_modules/C", segments = ['node_modules', 'A', 'B', 'C']
            // We try lifting C up so it lives under A instead of under A/.../B.
            const liftedParent = segments.slice(0, -2).concat([segments[segments.length - 2]]).join('/node_modules/');
            // Wait, simpler: rebuild
            // installPath = node_modules/<p1>/node_modules/<p2>/.../node_modules/<name>
            // We try lifting to: node_modules/<p1>/node_modules/<p2>/.../node_modules/<name> with the last but-one /node_modules/<pk>/ dropped.
            // i.e. take everything except the second-to-last "/node_modules/<pkg>/" segment.
            const liftedPath = liftOneLevel(installPath);
            if (!liftedPath || liftedPath === installPath)
                continue;
            const existing = resolved.get(liftedPath);
            if (existing) {
                if (existing.version === dep.version) {
                    // Already a copy at the higher level — just remove this one.
                    resolved.delete(installPath);
                    anyMoved = true;
                }
                continue;
            }
            // Move
            const newDep = { ...dep, installPath: liftedPath };
            const newParent = parentOfInstallPath(liftedPath);
            if (newParent)
                newDep.parentPath = newParent;
            else
                delete newDep.parentPath;
            resolved.set(liftedPath, newDep);
            resolved.delete(installPath);
            anyMoved = true;
        }
    }
};
// Given an install path like:
//   node_modules/A/node_modules/B/node_modules/foo
// drop one nesting level (the last package before foo's slot) →
//   node_modules/A/node_modules/foo
// Returns null if already at top level or can't be lifted.
const liftOneLevel = (installPath) => {
    const segments = installPath.split('/node_modules/');
    if (segments.length < 3)
        return null; // already top-level
    // Drop the second-to-last segment (the immediate parent pkg name)
    const newSegments = [...segments.slice(0, segments.length - 2), segments[segments.length - 1]];
    return newSegments.join('/node_modules/');
};
const parentOfInstallPath = (installPath) => {
    const idx = installPath.lastIndexOf('/node_modules/');
    if (idx === -1)
        return undefined;
    return installPath.slice(0, idx);
};
// For a set of install paths like:
//   node_modules/A/node_modules/B/node_modules/foo
//   node_modules/A/node_modules/B/node_modules/C/node_modules/foo
// return the LCA prefix: "node_modules/A/node_modules/B"
//
// Strips the trailing "/node_modules/<name>" from each path, then takes the
// longest common path-prefix (in /-separated segments).
const longestCommonInstallAncestor = (paths) => {
    if (paths.length === 0)
        return '';
    // Strip the final "/node_modules/<name>" to get the ancestor dir.
    // - "node_modules/foo" → "" (it lives at the root level)
    // - "node_modules/A/node_modules/foo" → "node_modules/A"
    const ancestors = paths.map((p) => {
        const idx = p.lastIndexOf('/node_modules/');
        if (idx === -1)
            return '';
        return p.slice(0, idx);
    });
    let common = ancestors[0].split('/');
    for (let i = 1; i < ancestors.length; i++) {
        const p = ancestors[i].split('/');
        const next = [];
        for (let j = 0; j < Math.min(common.length, p.length); j++) {
            if (common[j] === p[j])
                next.push(common[j]);
            else
                break;
        }
        common = next;
    }
    return common.join('/');
};
//# sourceMappingURL=resolver.js.map