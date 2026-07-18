#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dist/cli/dpm.js
var dpm_exports = {};
__export(dpm_exports, {
  main: () => main
});
module.exports = __toCommonJS(dpm_exports);

// dist/commands/install.js
var fs6 = __toESM(require("node:fs"), 1);
var path8 = __toESM(require("node:path"), 1);

// dist/core/registry.js
var fetchBuffer = async (url, accept) => {
  const opts = {};
  if (accept)
    opts.headers = { "Accept": accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};
var fetchJson = async (url, accept) => {
  const opts = {};
  if (accept)
    opts.headers = { "Accept": accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.json();
};
var createRegistryClient = (registryUrl) => {
  const base = registryUrl.replace(/\/+$/, "");
  return {
    async getPackument(name) {
      const url = `${base}/${encodeURIComponent(name).replace(/%2[fF]/g, "/")}`;
      return fetchJson(url, "application/vnd.npm.install-v1+json");
    },
    async getTarball(url) {
      return fetchBuffer(url);
    }
  };
};

// dist/core/resolver.js
var path = __toESM(require("node:path"), 1);

// dist/semver/index.js
var SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
var parse = (version) => {
  const m = SEMVER_RE.exec(version.trim());
  if (!m)
    return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split(".") : [],
    build: m[5] ? m[5].split(".") : [],
    raw: version
  };
};
var valid = (version) => parse(version) !== null;
var compare = (a, b) => {
  const av = typeof a === "string" ? parse(a) : a;
  const bv = typeof b === "string" ? parse(b) : b;
  if (!av || !bv)
    return 0;
  if (av.major !== bv.major)
    return av.major > bv.major ? 1 : -1;
  if (av.minor !== bv.minor)
    return av.minor > bv.minor ? 1 : -1;
  if (av.patch !== bv.patch)
    return av.patch > bv.patch ? 1 : -1;
  if (av.prerelease.length === 0 && bv.prerelease.length === 0)
    return 0;
  if (av.prerelease.length === 0)
    return 1;
  if (bv.prerelease.length === 0)
    return -1;
  for (let i = 0; i < Math.max(av.prerelease.length, bv.prerelease.length); i++) {
    const ai = av.prerelease[i];
    const bi = bv.prerelease[i];
    if (ai === void 0)
      return -1;
    if (bi === void 0)
      return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = parseInt(ai, 10);
      const bn = parseInt(bi, 10);
      if (an !== bn)
        return an > bn ? 1 : -1;
    } else if (aNum)
      return -1;
    else if (bNum)
      return 1;
    else {
      if (ai < bi)
        return -1;
      if (ai > bi)
        return 1;
    }
  }
  return 0;
};
var gt = (a, b) => compare(a, b) === 1;
var gte = (a, b) => compare(a, b) >= 0;
var lt = (a, b) => compare(a, b) === -1;
var lte = (a, b) => compare(a, b) <= 0;
var eq = (a, b) => compare(a, b) === 0;
var toComparator = (op, ver) => {
  const target = parse(ver);
  if (!target)
    return () => false;
  switch (op) {
    case "=":
    case "":
      return (v) => eq(v, target);
    case ">":
      return (v) => gt(v, target);
    case ">=":
      return (v) => gte(v, target);
    case "<":
      return (v) => lt(v, target);
    case "<=":
      return (v) => lte(v, target);
    default:
      return () => false;
  }
};
var X_TOKEN_RE = /^[xX*]$/;
var parsePartial = (raw) => {
  let s = raw.trim();
  if (s.startsWith("v") || s.startsWith("V"))
    s = s.slice(1);
  if (s === "" || s === "*" || s === "x" || s === "X") {
    return { major: null, minor: null, patch: null, prerelease: [] };
  }
  let prerelease = [];
  const dashIdx = s.indexOf("-");
  const plusIdx = s.indexOf("+");
  let core = s;
  if (dashIdx >= 0) {
    core = s.slice(0, dashIdx);
    const tail = s.slice(dashIdx + 1);
    const tailEnd = plusIdx > dashIdx ? plusIdx - dashIdx - 1 : tail.length;
    prerelease = tail.slice(0, tailEnd).split(".");
  } else if (plusIdx >= 0) {
    core = s.slice(0, plusIdx);
  }
  const segs = core.split(".");
  if (segs.length === 0 || segs.length > 3)
    return null;
  const parseSeg = (seg) => {
    if (seg === void 0)
      return null;
    if (X_TOKEN_RE.test(seg))
      return null;
    if (!/^\d+$/.test(seg))
      return null;
    return parseInt(seg, 10);
  };
  const major = parseSeg(segs[0]);
  const minor = parseSeg(segs[1]);
  const patch = parseSeg(segs[2]);
  if (segs[0] !== void 0 && !X_TOKEN_RE.test(segs[0]) && major === null)
    return null;
  return { major, minor, patch, prerelease };
};
var partialToFull = (p, fillUpper) => {
  const M = p.major ?? (fillUpper ? 0 : 0);
  const m = p.minor ?? (fillUpper ? 0 : 0);
  const pa = p.patch ?? (fillUpper ? 0 : 0);
  const pre = p.prerelease.length > 0 ? "-" + p.prerelease.join(".") : "";
  return `${M}.${m}.${pa}${pre}`;
};
var caretRange = (raw) => {
  const target = parsePartial(raw);
  if (!target)
    return [() => false];
  if (target.major === null)
    return [() => true];
  const lo = partialToFull({
    major: target.major,
    minor: target.minor ?? 0,
    patch: target.patch ?? 0,
    prerelease: target.prerelease
  }, false);
  let hi;
  if (target.major > 0 || target.minor === null) {
    hi = `${target.major + 1}.0.0-0`;
  } else if (target.minor > 0 || target.patch === null) {
    hi = `0.${target.minor + 1}.0-0`;
  } else {
    hi = `0.0.${(target.patch ?? 0) + 1}-0`;
  }
  return [toComparator(">=", lo), toComparator("<", hi)];
};
var tildeRange = (raw) => {
  const target = parsePartial(raw);
  if (!target)
    return [() => false];
  if (target.major === null)
    return [() => true];
  const lo = partialToFull({
    major: target.major,
    minor: target.minor ?? 0,
    patch: target.patch ?? 0,
    prerelease: target.prerelease
  }, false);
  const hi = target.minor === null ? `${target.major + 1}.0.0-0` : `${target.major}.${target.minor + 1}.0-0`;
  return [toComparator(">=", lo), toComparator("<", hi)];
};
var xRange = (raw) => {
  const target = parsePartial(raw);
  if (!target)
    return [() => false];
  if (target.major === null)
    return [() => true];
  if (target.minor === null) {
    return [
      toComparator(">=", `${target.major}.0.0`),
      toComparator("<", `${target.major + 1}.0.0-0`)
    ];
  }
  if (target.patch === null) {
    return [
      toComparator(">=", `${target.major}.${target.minor}.0`),
      toComparator("<", `${target.major}.${target.minor + 1}.0-0`)
    ];
  }
  return [toComparator("=", partialToFull(target, false))];
};
var tokenizeRange = (range) => {
  const tokens = [];
  let i = 0;
  while (i < range.length) {
    if (/\s/.test(range[i])) {
      i++;
      continue;
    }
    let tok = "";
    if (range[i] === ">" || range[i] === "<") {
      tok += range[i++];
      if (range[i] === "=")
        tok += range[i++];
      while (i < range.length && /\s/.test(range[i]))
        i++;
      while (i < range.length && !/\s/.test(range[i]))
        tok += range[i++];
    } else if (range[i] === "=" || range[i] === "~" || range[i] === "^") {
      tok += range[i++];
      while (i < range.length && /\s/.test(range[i]))
        i++;
      while (i < range.length && !/\s/.test(range[i]))
        tok += range[i++];
    } else if (range[i] === "-" && tok === "") {
      tok = "-";
      i++;
    } else {
      while (i < range.length && !/\s/.test(range[i]))
        tok += range[i++];
    }
    if (tok !== "")
      tokens.push(tok);
  }
  return tokens;
};
var expandRange = (range) => {
  range = range.trim();
  if (range === "" || range === "*" || range === "latest" || range === "x" || range === "X") {
    return [() => true];
  }
  const hyphenMatch = /^([^\s]+)\s+-\s+([^\s]+)$/.exec(range);
  if (hyphenMatch) {
    const lo = parsePartial(hyphenMatch[1]);
    const hi = parsePartial(hyphenMatch[2]);
    if (!lo || !hi)
      return [() => false];
    const loStr = partialToFull({ major: lo.major ?? 0, minor: lo.minor ?? 0, patch: lo.patch ?? 0, prerelease: lo.prerelease }, false);
    let hiCmp;
    if (hi.minor === null) {
      hiCmp = toComparator("<", `${(hi.major ?? 0) + 1}.0.0-0`);
    } else if (hi.patch === null) {
      hiCmp = toComparator("<", `${hi.major ?? 0}.${hi.minor + 1}.0-0`);
    } else {
      hiCmp = toComparator("<=", partialToFull(hi, false));
    }
    return [toComparator(">=", loStr), hiCmp];
  }
  if (range.startsWith("^"))
    return caretRange(range.slice(1));
  if (range.startsWith("~"))
    return tildeRange(range.slice(1));
  const tokens = tokenizeRange(range);
  if (tokens.length === 0)
    return [() => false];
  const comparators = [];
  for (const tok of tokens) {
    const opMatch = /^(>=|<=|>|<|=)(.+)$/.exec(tok);
    if (opMatch) {
      const op = opMatch[1];
      const verRaw = opMatch[2];
      const partial = parsePartial(verRaw);
      if (!partial) {
        comparators.push(() => false);
        continue;
      }
      if (partial.major === null) {
        comparators.push(op === "<" || op === "<=" ? () => false : () => true);
        continue;
      }
      if (partial.minor === null || partial.patch === null) {
        if (op === ">=" || op === ">") {
          const lo = partialToFull({ major: partial.major, minor: partial.minor ?? 0, patch: partial.patch ?? 0, prerelease: partial.prerelease }, false);
          comparators.push(toComparator(op, lo));
        } else if (op === "<" || op === "<=") {
          if (partial.minor === null) {
            comparators.push(toComparator("<", `${partial.major + (op === "<=" ? 1 : 0)}.0.0-0`));
          } else {
            comparators.push(toComparator("<", `${partial.major}.${partial.minor + (op === "<=" ? 1 : 0)}.0-0`));
          }
        } else {
          for (const c of xRange(verRaw))
            comparators.push(c);
        }
        continue;
      }
      comparators.push(toComparator(op, partialToFull(partial, false)));
      continue;
    }
    if (tok.startsWith("^")) {
      for (const c of caretRange(tok.slice(1)))
        comparators.push(c);
      continue;
    }
    if (tok.startsWith("~")) {
      for (const c of tildeRange(tok.slice(1)))
        comparators.push(c);
      continue;
    }
    for (const c of xRange(tok))
      comparators.push(c);
  }
  return comparators;
};
var extractMentionedVersions = (range) => {
  const mentioned = [];
  const trimmed = range.trim();
  const hyphenMatch = /^([^\s]+)\s+-\s+([^\s]+)$/.exec(trimmed);
  if (hyphenMatch) {
    for (const part of [hyphenMatch[1], hyphenMatch[2]]) {
      const p = parsePartial(part);
      if (p && p.major !== null) {
        const full = parse(partialToFull({ major: p.major, minor: p.minor ?? 0, patch: p.patch ?? 0, prerelease: p.prerelease }, false));
        if (full)
          mentioned.push(full);
      }
    }
    return mentioned;
  }
  const tokens = tokenizeRange(trimmed);
  for (const tok of tokens) {
    let body = tok;
    const opMatch = /^(>=|<=|>|<|=|~|\^)(.+)$/.exec(tok);
    if (opMatch)
      body = opMatch[2];
    const p = parsePartial(body);
    if (p && p.major !== null) {
      const full = parse(partialToFull({ major: p.major, minor: p.minor ?? 0, patch: p.patch ?? 0, prerelease: p.prerelease }, false));
      if (full)
        mentioned.push(full);
    }
  }
  return mentioned;
};
var satisfies = (version, range, opts = {}) => {
  const v = parse(version);
  if (!v)
    return false;
  for (const alt of range.split("||")) {
    const comparators = expandRange(alt);
    if (comparators.length === 0)
      continue;
    if (!comparators.every((c) => c(v)))
      continue;
    if (v.prerelease.length > 0 && !opts.includePrerelease) {
      const mentioned = extractMentionedVersions(alt);
      const same = mentioned.some((m) => m.major === v.major && m.minor === v.minor && m.patch === v.patch && m.prerelease.length > 0);
      if (!same)
        continue;
    }
    return true;
  }
  return false;
};
var maxSatisfying = (versions, range) => {
  let best = null;
  let bestStr = null;
  for (const ver of versions) {
    if (!satisfies(ver, range))
      continue;
    const parsed = parse(ver);
    if (!parsed)
      continue;
    if (!best || gt(parsed, best)) {
      best = parsed;
      bestStr = ver;
    }
  }
  return bestStr;
};

// dist/core/resolver.js
var classifySpec = (rawSpec, rootDir) => {
  const s = rawSpec.trim();
  if (s === "" || s === "*" || s === "latest")
    return { kind: "registry", range: s || "latest" };
  if (/^(npm:)/i.test(s))
    return { kind: "registry", range: s.slice(4) };
  if (/^https?:\/\//i.test(s))
    return { kind: "url", url: s };
  if (/^file:/i.test(s)) {
    const p = s.slice(5);
    const resolved = rootDir ? path.resolve(rootDir, p) : path.resolve(p);
    return { kind: "file", filePath: resolved };
  }
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/i.test(s)) {
    return { kind: "unsupported", reason: "git deps not supported" };
  }
  if (/^workspace:/i.test(s)) {
    return { kind: "unsupported", reason: "workspace: protocol not supported" };
  }
  return { kind: "registry", range: s };
};
var resolveOneVersion = (packument, range) => {
  const versions = Object.keys(packument.versions);
  const distTag = packument["dist-tags"]?.[range];
  if (distTag)
    return distTag;
  if (valid(range))
    return range;
  return maxSatisfying(versions, range);
};
var rootInstallPath = (name) => `node_modules/${name}`;
var nestedInstallPath = (parentPath, name) => `${parentPath}/node_modules/${name}`;
var findCompatibleAncestor = (resolved, parentPath, name, range) => {
  const candidates = [];
  let cur = parentPath;
  while (cur) {
    candidates.push(`${cur}/node_modules/${name}`);
    const idx = cur.lastIndexOf("/node_modules/");
    if (idx === -1)
      break;
    cur = cur.slice(0, idx);
    if (cur === "" || cur === "node_modules")
      break;
  }
  candidates.push(rootInstallPath(name));
  for (const cp of candidates) {
    const dep = resolved.get(cp);
    if (dep && satisfies(dep.version, range))
      return { installPath: cp, dep };
  }
  return null;
};
var rootHasConflict = (resolved, name, range) => {
  const rootPath = rootInstallPath(name);
  const existing = resolved.get(rootPath);
  if (!existing)
    return false;
  return !satisfies(existing.version, range);
};
var synthesizeUrlDep = (name, url, isDev, isOptional, isPeer, installPath) => {
  const m = /[^/]+?-(\d[^/]*?)\.t(?:ar\.)?gz$/.exec(url);
  const version = m?.[1] ?? "0.0.0-url";
  return {
    name,
    version,
    tarballUrl: url,
    dependencies: {},
    isDev,
    ...isOptional ? { isOptional: true } : {},
    ...isPeer ? { isPeer: true } : {},
    rawSpec: url,
    installPath
  };
};
var synthesizeFileDep = (name, absPath, isDev, isOptional, isPeer, installPath) => {
  return {
    name,
    version: "0.0.0-file",
    tarballUrl: "",
    dependencies: {},
    isDev,
    ...isOptional ? { isOptional: true } : {},
    ...isPeer ? { isPeer: true } : {},
    rawSpec: `file:${absPath}`,
    localPath: absPath,
    installPath
  };
};
var resolveDeps = async (opts) => {
  const resolved = /* @__PURE__ */ new Map();
  const errors = [];
  const warnings = [];
  const packumentCache = /* @__PURE__ */ new Map();
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
    frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: false, isPeer: false, parentPath: void 0 });
  }
  if (opts.includeDev !== false) {
    for (const [n, r] of Object.entries(opts.rootDevDeps ?? {})) {
      frontier.push({ name: n, rawSpec: r, isDev: true, isOptional: false, isPeer: false, parentPath: void 0 });
    }
  }
  for (const [n, r] of Object.entries(opts.rootOptionalDeps ?? {})) {
    frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: true, isPeer: false, parentPath: void 0 });
  }
  for (const [n, r] of Object.entries(opts.rootPeerDeps ?? {})) {
    frontier.push({ name: n, rawSpec: r, isDev: false, isOptional: false, isPeer: true, parentPath: void 0 });
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
      const hit = findCompatibleAncestor(resolved, item.parentPath, item.name, item.rawSpec);
      if (hit)
        continue;
      const spec = classifySpec(item.rawSpec, opts.rootDir);
      if (spec.kind === "url") {
        const installPath = item.parentPath && rootHasConflict(resolved, item.name, item.rawSpec) ? nestedInstallPath(item.parentPath, item.name) : rootInstallPath(item.name);
        if (resolved.has(installPath))
          continue;
        resolved.set(installPath, synthesizeUrlDep(item.name, spec.url, item.isDev, item.isOptional, item.isPeer, installPath));
        continue;
      }
      if (spec.kind === "file") {
        const installPath = item.parentPath && rootHasConflict(resolved, item.name, item.rawSpec) ? nestedInstallPath(item.parentPath, item.name) : rootInstallPath(item.name);
        if (resolved.has(installPath))
          continue;
        resolved.set(installPath, synthesizeFileDep(item.name, spec.filePath, item.isDev, item.isOptional, item.isPeer, installPath));
        continue;
      }
      if (spec.kind === "unsupported") {
        warnings.push(`Skipping ${item.name}@${item.rawSpec}: ${spec.reason}`);
        continue;
      }
      registryItems.push(item);
    }
    const byName = /* @__PURE__ */ new Map();
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
      for (const req of requests) {
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
        let installPath = rootInstallPath(req.name);
        const rootSlot = resolved.get(installPath);
        if (rootSlot && rootSlot.version !== candidate) {
          if (req.parentPath) {
            installPath = nestedInstallPath(req.parentPath, req.name);
            if (resolved.has(installPath))
              continue;
          } else {
            if (gt(candidate, rootSlot.version)) {
              resolved.set(installPath, {
                name: req.name,
                version: candidate,
                tarballUrl: v.dist.tarball,
                ...v.dist.integrity !== void 0 ? { integrity: v.dist.integrity } : {},
                ...v.dist.shasum !== void 0 ? { shasum: v.dist.shasum } : {},
                dependencies: v.dependencies ?? {},
                isDev: req.isDev,
                ...req.isOptional ? { isOptional: true } : {},
                ...req.isPeer ? { isPeer: true } : {},
                installPath
              });
              enqueueSubDeps(v, installPath, nextFrontier);
            }
            continue;
          }
        } else if (rootSlot && rootSlot.version === candidate) {
          continue;
        }
        resolved.set(installPath, {
          name: req.name,
          version: candidate,
          tarballUrl: v.dist.tarball,
          ...v.dist.integrity !== void 0 ? { integrity: v.dist.integrity } : {},
          ...v.dist.shasum !== void 0 ? { shasum: v.dist.shasum } : {},
          dependencies: v.dependencies ?? {},
          isDev: req.isDev,
          ...req.isOptional ? { isOptional: true } : {},
          ...req.isPeer ? { isPeer: true } : {},
          installPath,
          ...req.parentPath !== void 0 ? { parentPath: req.parentPath } : {}
        });
        enqueueSubDeps(v, installPath, nextFrontier);
      }
    }
    frontier = nextFrontier;
  }
  hoistPass(resolved);
  return { resolved, errors, warnings };
};
var hoistPass = (resolved) => {
  const byName = /* @__PURE__ */ new Map();
  for (const installPath of resolved.keys()) {
    const dep = resolved.get(installPath);
    const list = byName.get(dep.name);
    if (list)
      list.push(installPath);
    else
      byName.set(dep.name, [installPath]);
  }
  const targetInstallPath = (ancestor, name) => {
    if (ancestor === "" || ancestor === "node_modules")
      return `node_modules/${name}`;
    return `${ancestor}/node_modules/${name}`;
  };
  for (const [name, paths] of byName) {
    if (paths.length < 2)
      continue;
    const byVersion = /* @__PURE__ */ new Map();
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
    for (const [version, vPaths] of byVersion) {
      if (vPaths.length < 2)
        continue;
      const lca = longestCommonInstallAncestor(vPaths);
      const target = targetInstallPath(lca, name);
      if (vPaths.includes(target)) {
        for (const p of vPaths) {
          if (p !== target)
            resolved.delete(p);
        }
        continue;
      }
      const existing = resolved.get(target);
      if (existing && existing.version !== version)
        continue;
      let safe = true;
      let walk = lca;
      while (walk !== "" && walk !== "node_modules") {
        const ancestorTarget = targetInstallPath(walk, name);
        const e = resolved.get(ancestorTarget);
        if (e && e.version !== version && ancestorTarget !== target) {
          safe = false;
          break;
        }
        const idx = walk.lastIndexOf("/node_modules/");
        if (idx === -1)
          break;
        walk = walk.slice(0, idx);
      }
      if (!safe)
        continue;
      const canonical = resolved.get(vPaths[0]);
      const newDep = { ...canonical, installPath: target };
      if (lca === "" || lca === "node_modules") {
        delete newDep.parentPath;
      } else {
        newDep.parentPath = lca;
      }
      resolved.set(target, newDep);
      for (const p of vPaths) {
        if (p !== target)
          resolved.delete(p);
      }
    }
    if (!resolved.has(rootPath)) {
      const stillByVersion = /* @__PURE__ */ new Map();
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
  let anyMoved = true;
  let safetyIters = 0;
  while (anyMoved && safetyIters++ < 32) {
    anyMoved = false;
    for (const installPath of [...resolved.keys()]) {
      const dep = resolved.get(installPath);
      if (!dep)
        continue;
      const segments = installPath.split("/node_modules/");
      if (segments.length < 3)
        continue;
      const liftedParent = segments.slice(0, -2).concat([segments[segments.length - 2]]).join("/node_modules/");
      const liftedPath = liftOneLevel(installPath);
      if (!liftedPath || liftedPath === installPath)
        continue;
      const existing = resolved.get(liftedPath);
      if (existing) {
        if (existing.version === dep.version) {
          resolved.delete(installPath);
          anyMoved = true;
        }
        continue;
      }
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
var liftOneLevel = (installPath) => {
  const segments = installPath.split("/node_modules/");
  if (segments.length < 3)
    return null;
  const newSegments = [...segments.slice(0, segments.length - 2), segments[segments.length - 1]];
  return newSegments.join("/node_modules/");
};
var parentOfInstallPath = (installPath) => {
  const idx = installPath.lastIndexOf("/node_modules/");
  if (idx === -1)
    return void 0;
  return installPath.slice(0, idx);
};
var longestCommonInstallAncestor = (paths) => {
  if (paths.length === 0)
    return "";
  const ancestors = paths.map((p) => {
    const idx = p.lastIndexOf("/node_modules/");
    if (idx === -1)
      return "";
    return p.slice(0, idx);
  });
  let common = ancestors[0].split("/");
  for (let i = 1; i < ancestors.length; i++) {
    const p = ancestors[i].split("/");
    const next = [];
    for (let j = 0; j < Math.min(common.length, p.length); j++) {
      if (common[j] === p[j])
        next.push(common[j]);
      else
        break;
    }
    common = next;
  }
  return common.join("/");
};

// dist/core/tarball.js
var zlib = __toESM(require("node:zlib"), 1);
var fs = __toESM(require("node:fs"), 1);
var path2 = __toESM(require("node:path"), 1);
var decodeAscii = (bytes, start, len) => {
  let end = start + len;
  while (end > start && bytes[end - 1] === 0)
    end--;
  let s = "";
  for (let i = start; i < end; i++)
    s += String.fromCharCode(bytes[i]);
  return s;
};
var parseOctal = (bytes, start, len) => {
  const s = decodeAscii(bytes, start, len).trim();
  return s ? parseInt(s, 8) : 0;
};
var parseTar = (bytes) => {
  const entries = [];
  let pos = 0;
  let pendingLongName;
  while (pos + 512 <= bytes.length) {
    let isEmpty = true;
    for (let i = 0; i < 512; i++) {
      if (bytes[pos + i] !== 0) {
        isEmpty = false;
        break;
      }
    }
    if (isEmpty)
      break;
    let name = decodeAscii(bytes, pos, 100);
    const mode = parseOctal(bytes, pos + 100, 8);
    const size = parseOctal(bytes, pos + 124, 12);
    const typeflag = String.fromCharCode(bytes[pos + 156]);
    const prefix = decodeAscii(bytes, pos + 345, 155);
    if (prefix)
      name = prefix + "/" + name;
    if (pendingLongName) {
      name = pendingLongName;
      pendingLongName = void 0;
    }
    const dataStart = pos + 512;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    const body = bytes.slice(dataStart, dataEnd);
    let type = "other";
    if (typeflag === "0" || typeflag === "" || typeflag === "\0")
      type = "file";
    else if (typeflag === "5")
      type = "dir";
    else if (typeflag === "2")
      type = "symlink";
    else if (typeflag === "L")
      type = "longname";
    else if (typeflag === "K")
      type = "longlink";
    if (type === "longname") {
      pendingLongName = decodeAscii(body, 0, body.length).replace(/\0+$/, "");
      pos = paddedEnd;
      continue;
    }
    if (type === "longlink") {
      pos = paddedEnd;
      continue;
    }
    entries.push({ name, size, type, mode, body });
    pos = paddedEnd;
  }
  return entries;
};
var ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
  }
};
var extractTarball = async (tarballBytes, destDir, options = {}) => {
  let tarBytes;
  if (tarballBytes[0] === 31 && tarballBytes[1] === 139) {
    tarBytes = new Uint8Array(zlib.gunzipSync(tarballBytes));
  } else {
    tarBytes = tarballBytes;
  }
  const entries = parseTar(tarBytes);
  const strip = options.stripComponents ?? 0;
  ensureDir(destDir);
  for (const entry of entries) {
    let name = entry.name;
    if (name.includes(".."))
      continue;
    if (strip > 0) {
      const parts = name.split("/");
      if (parts.length <= strip)
        continue;
      name = parts.slice(strip).join("/");
    }
    if (!name)
      continue;
    const fullPath = path2.join(destDir, name);
    if (entry.type === "dir") {
      ensureDir(fullPath);
      continue;
    }
    if (entry.type === "file") {
      ensureDir(path2.dirname(fullPath));
      fs.writeFileSync(fullPath, entry.body);
      try {
        fs.chmodSync(fullPath, entry.mode & 511);
      } catch {
      }
      continue;
    }
    if (entry.type === "symlink") {
      continue;
    }
  }
};

// dist/core/cache.js
var fs2 = __toESM(require("node:fs"), 1);
var path3 = __toESM(require("node:path"), 1);
var crypto = __toESM(require("node:crypto"), 1);
var ensureDir2 = (dir) => {
  try {
    fs2.mkdirSync(dir, { recursive: true });
  } catch {
  }
};
var decodeIntegrity = (integrity) => {
  const dash = integrity.indexOf("-");
  if (dash === -1)
    return null;
  return { alg: integrity.slice(0, dash), hash: integrity.slice(dash + 1) };
};
var computeHexFromIntegrity = (integrity) => {
  const decoded = decodeIntegrity(integrity);
  if (!decoded)
    return integrity.replace(/[^0-9a-fA-F]/g, "");
  try {
    const buf = Buffer.from(decoded.hash, "base64");
    return buf.toString("hex");
  } catch {
    return decoded.hash.replace(/[^0-9a-fA-F]/g, "");
  }
};
var createCache = (cacheDir) => {
  return {
    pathFor(integrity) {
      const decoded = decodeIntegrity(integrity);
      const alg = decoded?.alg ?? "sha512";
      const hex = computeHexFromIntegrity(integrity);
      const shard1 = hex.slice(0, 2);
      const shard2 = hex.slice(2, 4);
      return path3.join(cacheDir, alg, shard1, shard2, hex);
    },
    has(integrity) {
      try {
        return fs2.existsSync(this.pathFor(integrity));
      } catch {
        return false;
      }
    },
    read(integrity) {
      try {
        const p = this.pathFor(integrity);
        if (!fs2.existsSync(p))
          return null;
        return new Uint8Array(fs2.readFileSync(p));
      } catch {
        return null;
      }
    },
    write(integrity, bytes) {
      const p = this.pathFor(integrity);
      ensureDir2(path3.dirname(p));
      fs2.writeFileSync(p, bytes);
    }
  };
};
var computeShasumIntegrity = (bytes, algorithm = "sha512") => {
  const hash = crypto.createHash(algorithm).update(bytes).digest("base64");
  return `${algorithm}-${hash}`;
};

// dist/core/integrity.js
var crypto2 = __toESM(require("node:crypto"), 1);
var verifyIntegrity = (bytes, integrity) => {
  if (integrity.startsWith("sha512-")) {
    const expected = integrity.slice(7);
    const hash = crypto2.createHash("sha512").update(bytes).digest("base64");
    return hash === expected;
  }
  if (integrity.startsWith("sha256-")) {
    const expected = integrity.slice(7);
    const hash = crypto2.createHash("sha256").update(bytes).digest("base64");
    return hash === expected;
  }
  if (integrity.startsWith("sha1-")) {
    const expected = integrity.slice(5);
    const hash = crypto2.createHash("sha1").update(bytes).digest("base64");
    return hash === expected;
  }
  if (/^[0-9a-f]{40}$/i.test(integrity)) {
    const hash = crypto2.createHash("sha1").update(bytes).digest("hex");
    return hash === integrity.toLowerCase();
  }
  return false;
};

// dist/core/manifest.js
var fs3 = __toESM(require("node:fs"), 1);
var path4 = __toESM(require("node:path"), 1);
var readPackageJson = (cwd) => {
  const p = path4.join(cwd, "package.json");
  if (!fs3.existsSync(p))
    return {};
  let content;
  try {
    content = fs3.readFileSync(p, "utf8");
  } catch {
    return {};
  }
  if (content.trim() === "")
    return {};
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Cannot parse ${p}: ${e.message}`);
  }
};
var writePackageJson = (cwd, pkg) => {
  const p = path4.join(cwd, "package.json");
  fs3.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
};
var mergeDep = (pkg, name, version, dev) => {
  if (dev) {
    pkg.devDependencies = pkg.devDependencies ?? {};
    pkg.devDependencies[name] = version;
    if (pkg.dependencies)
      delete pkg.dependencies[name];
  } else {
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies[name] = version;
    if (pkg.devDependencies)
      delete pkg.devDependencies[name];
  }
};
var removeDep = (pkg, name) => {
  if (pkg.dependencies)
    delete pkg.dependencies[name];
  if (pkg.devDependencies)
    delete pkg.devDependencies[name];
  if (pkg.peerDependencies)
    delete pkg.peerDependencies[name];
  if (pkg.optionalDependencies)
    delete pkg.optionalDependencies[name];
};

// dist/core/lockfile.js
var fs4 = __toESM(require("node:fs"), 1);
var path5 = __toESM(require("node:path"), 1);
var writeLockfile = (cwd, lockfile) => {
  const p = path5.join(cwd, "package-lock.json");
  fs4.writeFileSync(p, JSON.stringify(lockfile, null, 2) + "\n");
};
var buildLockfile = (pkgName, pkgVersion, rootDeps, rootDevDeps, resolved) => {
  const packages = {};
  packages[""] = {
    ...pkgName !== void 0 ? { name: pkgName } : {},
    ...pkgVersion !== void 0 ? { version: pkgVersion } : {},
    ...Object.keys(rootDeps).length > 0 ? { dependencies: rootDeps } : {},
    ...Object.keys(rootDevDeps).length > 0 ? { devDependencies: rootDevDeps } : {}
  };
  for (const [installPath, dep] of resolved) {
    const key = installPath;
    const subDeps = {};
    for (const [d, dr] of Object.entries(dep.dependencies))
      subDeps[d] = dr;
    packages[key] = {
      version: dep.version,
      resolved: dep.tarballUrl,
      ...dep.integrity !== void 0 ? { integrity: dep.integrity } : {},
      ...dep.isDev ? { dev: true } : {},
      ...Object.keys(subDeps).length > 0 ? { dependencies: subDeps } : {}
    };
  }
  const lockfile = {
    lockfileVersion: 3,
    requires: true,
    packages
  };
  if (pkgName !== void 0)
    lockfile.name = pkgName;
  if (pkgVersion !== void 0)
    lockfile.version = pkgVersion;
  return lockfile;
};

// dist/core/bin-shims.js
var fs5 = __toESM(require("node:fs"), 1);
var path6 = __toESM(require("node:path"), 1);
var detectTargetKind = (absTarget) => {
  try {
    const fd = fs5.openSync(absTarget, "r");
    try {
      const buf = Buffer.alloc(4);
      const n = fs5.readSync(fd, buf, 0, 4, 0);
      if (n >= 4) {
        if (buf[0] === 127 && buf[1] === 69 && buf[2] === 76 && buf[3] === 70)
          return "native";
        if (buf[0] === 254 && buf[1] === 237 && buf[2] === 250 && (buf[3] === 206 || buf[3] === 207) || buf[3] === 254 && buf[2] === 237 && buf[1] === 250 && (buf[0] === 206 || buf[0] === 207))
          return "native";
        if (buf[0] === 202 && buf[1] === 254 && buf[2] === 186 && buf[3] === 190)
          return "native";
        if (buf[0] === 77 && buf[1] === 90)
          return "native";
      }
      if (n >= 2 && buf[0] === 35 && buf[1] === 33)
        return "shebang";
      return "js";
    } finally {
      fs5.closeSync(fd);
    }
  } catch {
    return "js";
  }
};
var createBinShims = (binDir, pkgName, pkgDir, bin) => {
  if (!bin)
    return;
  if (!fs5.existsSync(binDir))
    fs5.mkdirSync(binDir, { recursive: true });
  const entries = [];
  if (typeof bin === "string") {
    const shortName = pkgName.split("/").pop() ?? pkgName;
    entries.push({ name: shortName, target: bin });
  } else {
    for (const [name, target] of Object.entries(bin)) {
      entries.push({ name, target });
    }
  }
  for (const { name, target } of entries) {
    const shimPath = path6.join(binDir, name);
    const absTarget = path6.join(pkgDir, target);
    const kind = fs5.existsSync(absTarget) ? detectTargetKind(absTarget) : "js";
    let shimContent;
    if (kind === "native") {
      shimContent = `#!/bin/sh
exec "${absTarget}" "$@"
`;
    } else if (kind === "shebang") {
      shimContent = `#!/bin/sh
exec "${absTarget}" "$@"
`;
    } else {
      shimContent = `#!/bin/sh
if [ -x /bin/node ]; then
  exec /bin/node "${absTarget}" "$@"
else
  exec node "${absTarget}" "$@"
fi
`;
    }
    try {
      fs5.writeFileSync(shimPath, shimContent);
      fs5.chmodSync(shimPath, 493);
      const targetStat = fs5.existsSync(absTarget) ? fs5.statSync(absTarget) : null;
      if (targetStat && !(targetStat.mode & 73)) {
        fs5.chmodSync(absTarget, targetStat.mode | 73);
      }
    } catch {
    }
  }
};

// dist/core/scripts.js
var child_process = __toESM(require("node:child_process"), 1);
var path7 = __toESM(require("node:path"), 1);

// dist/util/log.js
var silent = false;
var setSilent = (s) => {
  silent = s;
};
var log = (...args) => {
  if (silent)
    return;
  console.log(...args);
};
var info = (...args) => {
  if (silent)
    return;
  console.log(...args);
};
var warn = (...args) => {
  console.error("warn:", ...args);
};
var error = (...args) => {
  console.error("error:", ...args);
};

// dist/core/scripts.js
var runLifecycleScript = (pkg, scriptName, pkgDir, rootDir) => {
  const cmd = pkg.scripts?.[scriptName];
  if (!cmd)
    return 0;
  const npmEnv = {
    npm_lifecycle_event: scriptName,
    npm_package_name: pkg.name ?? "",
    npm_package_version: pkg.version ?? "",
    INIT_CWD: rootDir
  };
  for (const [k, v] of Object.entries(pkg.dependencies ?? {})) {
    npmEnv[`npm_package_dependencies_${k.replace(/[-@/]/g, "_")}`] = v;
  }
  const env = {
    ...process.env,
    ...npmEnv
  };
  const localBin = path7.join(rootDir, "node_modules", ".bin");
  env["PATH"] = `${localBin}:${env["PATH"] ?? ""}`;
  try {
    const result = child_process.spawnSync("/bin/sh", ["-c", cmd], {
      cwd: pkgDir,
      env,
      stdio: "inherit"
    });
    return result.status ?? 0;
  } catch (e) {
    warn(`${scriptName} script failed:`, e.message);
    return 1;
  }
};

// dist/util/env.js
var homeDir = () => {
  const g = globalThis;
  const proc = g["process"];
  return proc?.env?.["HOME"] ?? proc?.env?.["USERPROFILE"] ?? "/home/user";
};
var defaultCacheDir = () => {
  return homeDir() + "/.dpm/cache";
};
var defaultRegistry = () => {
  const g = globalThis;
  const proc = g["process"];
  return proc?.env?.["DPM_REGISTRY"] ?? proc?.env?.["npm_config_registry"] ?? "https://registry.npmjs.org";
};

// dist/util/p-all.js
var pAll = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const lanes = [];
  const n = Math.min(limit, items.length);
  for (let i = 0; i < n; i++) {
    lanes.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length)
          return;
        results[idx] = await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(lanes);
  return results;
};

// dist/commands/install.js
var DEFAULT_CONCURRENCY = 16;
var parsePackageSpec = (spec) => {
  if (spec.startsWith("@")) {
    const slashIdx = spec.indexOf("/");
    if (slashIdx === -1)
      return { name: spec, range: "latest" };
    const atIdx2 = spec.indexOf("@", slashIdx);
    if (atIdx2 === -1)
      return { name: spec, range: "latest" };
    return { name: spec.slice(0, atIdx2), range: spec.slice(atIdx2 + 1) || "latest" };
  }
  const atIdx = spec.indexOf("@");
  if (atIdx === -1)
    return { name: spec, range: "latest" };
  return { name: spec.slice(0, atIdx), range: spec.slice(atIdx + 1) || "latest" };
};
var installCommand = async (opts) => {
  const cwd = path8.resolve(opts.cwd);
  const registryUrl = opts.registry ?? defaultRegistry();
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const noScripts = opts.noScripts ?? false;
  let pkg = readPackageJson(cwd);
  if (opts.packages && opts.packages.length > 0) {
    const isDev = opts.saveDev ?? false;
    for (const spec of opts.packages) {
      const { name, range } = parsePackageSpec(spec);
      mergeDep(pkg, name, range === "latest" ? "*" : range, isDev);
    }
  }
  const rootDeps = pkg.dependencies ?? {};
  const rootDevDeps = pkg.devDependencies ?? {};
  const rootOptDeps = pkg.optionalDependencies ?? {};
  const rootPeerDeps = pkg.peerDependencies ?? {};
  if (Object.keys(rootDeps).length === 0 && Object.keys(rootDevDeps).length === 0 && Object.keys(rootOptDeps).length === 0 && Object.keys(rootPeerDeps).length === 0) {
    info("Nothing to install.");
    return 0;
  }
  info(`Resolving from ${registryUrl} ...`);
  const registry = createRegistryClient(registryUrl);
  const cache = createCache(cacheDir);
  const plan = await resolveDeps({
    registry,
    rootDeps,
    rootDevDeps,
    rootOptionalDeps: rootOptDeps,
    rootPeerDeps,
    rootDir: cwd,
    includeDev: true
  });
  if (plan.warnings.length > 0) {
    for (const w of plan.warnings)
      warn(w);
  }
  if (plan.errors.length > 0) {
    for (const e of plan.errors)
      error(e);
    if (plan.resolved.size === 0)
      return 1;
    warn("Continuing with partial resolution.");
  }
  info(`Resolved ${plan.resolved.size} packages.`);
  if (opts.packages && opts.packages.length > 0) {
    const isDev = opts.saveDev ?? false;
    for (const spec of opts.packages) {
      const { name } = parsePackageSpec(spec);
      const dep = plan.resolved.get(`node_modules/${name}`);
      if (dep)
        mergeDep(pkg, name, `^${dep.version}`, isDev);
    }
    writePackageJson(cwd, pkg);
  }
  const nodeModulesDir = path8.join(cwd, "node_modules");
  if (!fs6.existsSync(nodeModulesDir))
    fs6.mkdirSync(nodeModulesDir, { recursive: true });
  const binDir = path8.join(nodeModulesDir, ".bin");
  const absInstallDir = (dep) => {
    const ip = dep.installPath ?? `node_modules/${dep.name}`;
    return path8.join(cwd, ip);
  };
  const allDeps2 = [...plan.resolved.values()];
  const toInstall = allDeps2.filter((dep) => {
    const installPath = absInstallDir(dep);
    if (fs6.existsSync(path8.join(installPath, "package.json"))) {
      info(`  ${dep.name}@${dep.version} (already installed)`);
      return false;
    }
    return true;
  });
  const copyDirRecursive = (src, dst) => {
    if (!fs6.existsSync(src))
      return;
    fs6.mkdirSync(dst, { recursive: true });
    for (const entry of fs6.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === "node_modules")
        continue;
      const srcP = path8.join(src, entry.name);
      const dstP = path8.join(dst, entry.name);
      if (entry.isDirectory())
        copyDirRecursive(srcP, dstP);
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs6.readlinkSync(srcP);
          fs6.symlinkSync(target, dstP);
        } catch {
        }
      } else {
        try {
          fs6.copyFileSync(srcP, dstP);
        } catch {
        }
      }
    }
  };
  await pAll(toInstall, DEFAULT_CONCURRENCY, async (dep) => {
    const installPath = absInstallDir(dep);
    info(`  ${dep.name}@${dep.version}`);
    const isTopLevel = !dep.installPath || !dep.installPath.includes("/node_modules/");
    if (dep.localPath) {
      if (!fs6.existsSync(dep.localPath)) {
        const msg = `file: source not found for ${dep.name}: ${dep.localPath}`;
        if (dep.isOptional)
          warn(msg);
        else
          error(msg);
        return;
      }
      const srcPkgPath = path8.join(dep.localPath, "package.json");
      if (fs6.existsSync(srcPkgPath)) {
        try {
          const srcPkg = JSON.parse(fs6.readFileSync(srcPkgPath, "utf8"));
          if (srcPkg.version)
            dep.version = srcPkg.version;
          fs6.mkdirSync(installPath, { recursive: true });
          copyDirRecursive(dep.localPath, installPath);
          if (srcPkg.bin && isTopLevel)
            createBinShims(binDir, dep.name, installPath, srcPkg.bin);
        } catch (e) {
          const msg = `Failed to install file: dep ${dep.name}: ${e.message}`;
          if (dep.isOptional)
            warn(msg);
          else
            error(msg);
        }
      } else {
        const msg = `file: source has no package.json: ${dep.localPath}`;
        if (dep.isOptional)
          warn(msg);
        else
          error(msg);
      }
      return;
    }
    let tarballBytes = null;
    if (dep.integrity && cache.has(dep.integrity)) {
      tarballBytes = cache.read(dep.integrity);
    }
    if (!tarballBytes) {
      try {
        tarballBytes = await registry.getTarball(dep.tarballUrl);
      } catch (e) {
        const msg = `Fetch failed for ${dep.name}@${dep.version}: ${e.message}`;
        if (dep.isOptional)
          warn(msg);
        else
          error(msg);
        return;
      }
      const integ = dep.integrity ?? computeShasumIntegrity(tarballBytes);
      cache.write(integ, tarballBytes);
      if (dep.integrity && !verifyIntegrity(tarballBytes, dep.integrity)) {
        const msg = `Integrity check failed for ${dep.name}@${dep.version}`;
        if (dep.isOptional)
          warn(msg);
        else
          error(msg);
        return;
      }
    }
    fs6.mkdirSync(installPath, { recursive: true });
    try {
      await extractTarball(tarballBytes, installPath, { stripComponents: 1 });
    } catch (e) {
      const msg = `Extract failed for ${dep.name}@${dep.version}: ${e.message}`;
      if (dep.isOptional)
        warn(msg);
      else
        error(msg);
      try {
        fs6.rmSync(installPath, { recursive: true, force: true });
      } catch {
      }
      return;
    }
    const pkgJsonPath = path8.join(installPath, "package.json");
    if (!fs6.existsSync(pkgJsonPath) || fs6.statSync(pkgJsonPath).size === 0) {
      const msg = `Empty/missing package.json after extract for ${dep.name}@${dep.version}`;
      if (dep.isOptional)
        warn(msg);
      else
        error(msg);
      try {
        fs6.rmSync(installPath, { recursive: true, force: true });
      } catch {
      }
      return;
    }
    if (isTopLevel) {
      try {
        const subPkg = readPackageJson(installPath);
        if (subPkg.bin)
          createBinShims(binDir, dep.name, installPath, subPkg.bin);
      } catch {
      }
    }
  });
  if (!noScripts) {
    for (const dep of plan.resolved.values()) {
      const installPath = absInstallDir(dep);
      let subPkg;
      try {
        subPkg = readPackageJson(installPath);
      } catch (e) {
        warn(`  ${dep.name}: bad package.json, skipping lifecycle: ${e.message}`);
        continue;
      }
      if (!subPkg.scripts)
        continue;
      for (const phase of ["preinstall", "install", "postinstall"]) {
        if (subPkg.scripts[phase]) {
          info(`  running ${phase} for ${dep.name}`);
          const status = runLifecycleScript(subPkg, phase, installPath, cwd);
          if (status !== 0)
            warn(`  ${dep.name}: ${phase} exited ${status}`);
        }
      }
    }
    for (const phase of ["preinstall", "install", "postinstall", "prepare"]) {
      if (pkg.scripts?.[phase]) {
        info(`running ${phase} for root`);
        runLifecycleScript(pkg, phase, cwd, cwd);
      }
    }
  }
  const lockfile = buildLockfile(pkg.name, pkg.version, pkg.dependencies ?? {}, pkg.devDependencies ?? {}, plan.resolved);
  writeLockfile(cwd, lockfile);
  info(`Done. Installed ${plan.resolved.size} packages.`);
  return 0;
};

// dist/commands/uninstall.js
var fs7 = __toESM(require("node:fs"), 1);
var path9 = __toESM(require("node:path"), 1);
var uninstallCommand = async (opts) => {
  const cwd = path9.resolve(opts.cwd);
  const pkg = readPackageJson(cwd);
  for (const name of opts.packages) {
    removeDep(pkg, name);
    const pkgPath = path9.join(cwd, "node_modules", name);
    if (fs7.existsSync(pkgPath)) {
      fs7.rmSync(pkgPath, { recursive: true, force: true });
      info(`removed ${name}`);
    }
  }
  writePackageJson(cwd, pkg);
  return 0;
};

// dist/commands/run.js
var path10 = __toESM(require("node:path"), 1);
var child_process2 = __toESM(require("node:child_process"), 1);
var runCommand = async (opts) => {
  const cwd = path10.resolve(opts.cwd);
  const pkg = readPackageJson(cwd);
  const cmd = pkg.scripts?.[opts.script];
  if (!cmd) {
    error(`Script not found: ${opts.script}`);
    return 1;
  }
  const binDir = path10.join(cwd, "node_modules", ".bin");
  const fullCmd = opts.args.length > 0 ? `${cmd} ${opts.args.join(" ")}` : cmd;
  const env = {
    ...process.env,
    npm_lifecycle_event: opts.script,
    npm_package_name: pkg.name ?? "",
    npm_package_version: pkg.version ?? ""
  };
  env["PATH"] = `${binDir}:${env["PATH"] ?? ""}`;
  const result = child_process2.spawnSync("/bin/sh", ["-c", fullCmd], {
    cwd,
    env,
    stdio: "inherit"
  });
  return result.status ?? 1;
};

// dist/commands/list.js
var fs8 = __toESM(require("node:fs"), 1);
var path11 = __toESM(require("node:path"), 1);
var listCommand = async (opts) => {
  const cwd = path11.resolve(opts.cwd);
  const pkg = readPackageJson(cwd);
  const depth = opts.depth ?? 0;
  log(`${pkg.name ?? "<no name>"}@${pkg.version ?? "<no version>"} ${cwd}`);
  const nodeModules = path11.join(cwd, "node_modules");
  if (!fs8.existsSync(nodeModules)) {
    log("(no node_modules)");
    return 0;
  }
  const printTree = (dir, indent) => {
    if (depth > 0 && indent > depth)
      return;
    const entries = fs8.readdirSync(dir).filter((e) => !e.startsWith("."));
    for (const entry of entries) {
      const subPath = path11.join(dir, entry);
      const stat = fs8.statSync(subPath);
      if (!stat.isDirectory())
        continue;
      if (entry.startsWith("@")) {
        const scopedEntries = fs8.readdirSync(subPath);
        for (const inner of scopedEntries) {
          const innerPath = path11.join(subPath, inner);
          const innerStat = fs8.statSync(innerPath);
          if (!innerStat.isDirectory())
            continue;
          try {
            const sub = readPackageJson(innerPath);
            log(`${"  ".repeat(indent + 1)}${entry}/${inner}@${sub.version ?? "?"}`);
          } catch {
          }
        }
      } else {
        try {
          const sub = readPackageJson(subPath);
          log(`${"  ".repeat(indent + 1)}${entry}@${sub.version ?? "?"}`);
        } catch {
        }
      }
    }
  };
  printTree(nodeModules, 0);
  return 0;
};

// dist/commands/init.js
var path12 = __toESM(require("node:path"), 1);
var initCommand = async (opts) => {
  const cwd = path12.resolve(opts.cwd);
  let pkg = {};
  try {
    pkg = readPackageJson(cwd);
  } catch {
  }
  if (pkg.name && !opts.yes) {
    info(`package.json already exists for ${pkg.name}`);
    return 0;
  }
  const defaultName = opts.name ?? path12.basename(cwd);
  const newPkg = {
    name: pkg.name ?? defaultName,
    version: pkg.version ?? "1.0.0",
    description: pkg.description ?? "",
    main: pkg.main ?? "index.js",
    scripts: pkg.scripts ?? { test: 'echo "Error: no test specified" && exit 1' }
  };
  writePackageJson(cwd, newPkg);
  info(`Wrote ${path12.join(cwd, "package.json")}`);
  return 0;
};

// dist/commands/exec.js
var fs9 = __toESM(require("node:fs"), 1);
var path13 = __toESM(require("node:path"), 1);
var child_process3 = __toESM(require("node:child_process"), 1);
var findLocalBin = (cwd, name) => {
  const bin = path13.join(cwd, "node_modules", ".bin", name);
  if (fs9.existsSync(bin))
    return bin;
  let dir = cwd;
  while (dir !== "/") {
    const candidate = path13.join(dir, "node_modules", ".bin", name);
    if (fs9.existsSync(candidate))
      return candidate;
    dir = path13.dirname(dir);
  }
  return null;
};
var execCommand = async (opts) => {
  let binPath = findLocalBin(opts.cwd, opts.command);
  if (!binPath && opts.tempInstall) {
    const tmpDir = path13.join("/tmp", `dpx-${Date.now()}`);
    fs9.mkdirSync(tmpDir, { recursive: true });
    const pkgName = opts.packageName ?? opts.command;
    await installCommand({
      cwd: tmpDir,
      packages: [pkgName],
      saveDev: false,
      silent: true
    });
    binPath = findLocalBin(tmpDir, opts.command);
  }
  if (!binPath) {
    error(`Command not found: ${opts.command}`);
    return 127;
  }
  const result = child_process3.spawnSync(binPath, opts.args, {
    cwd: opts.cwd,
    stdio: "inherit",
    env: process.env
  });
  return result.status ?? 1;
};

// dist/commands/cache.js
var fs10 = __toESM(require("node:fs"), 1);
var cacheCommand = async (subcommand, _args) => {
  const dir = defaultCacheDir();
  if (subcommand === "clean") {
    if (fs10.existsSync(dir))
      fs10.rmSync(dir, { recursive: true, force: true });
    info(`Cache cleaned: ${dir}`);
    return 0;
  }
  if (subcommand === "verify" || subcommand === "ls") {
    info(`Cache directory: ${dir}`);
    if (!fs10.existsSync(dir))
      info("(empty)");
    return 0;
  }
  info("Usage: dpm cache <clean|verify|ls>");
  return 1;
};

// dist/commands/config.js
var fs11 = __toESM(require("node:fs"), 1);
var path14 = __toESM(require("node:path"), 1);
var configPath = () => path14.join(homeDir(), ".dpmrc");
var readConfig = () => {
  const p = configPath();
  if (!fs11.existsSync(p))
    return {};
  const out = {};
  const text = fs11.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
    const eq2 = trimmed.indexOf("=");
    if (eq2 === -1)
      continue;
    out[trimmed.slice(0, eq2).trim()] = trimmed.slice(eq2 + 1).trim();
  }
  return out;
};
var writeConfig = (config) => {
  const p = configPath();
  const text = Object.entries(config).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs11.writeFileSync(p, text);
};
var configCommand = async (subcommand, args) => {
  const config = readConfig();
  if (subcommand === "get") {
    const [key] = args;
    if (!key) {
      info("Usage: dpm config get <key>");
      return 1;
    }
    info(config[key] ?? "");
    return 0;
  }
  if (subcommand === "set") {
    const [key, value] = args;
    if (!key || value === void 0) {
      info("Usage: dpm config set <key> <value>");
      return 1;
    }
    config[key] = value;
    writeConfig(config);
    return 0;
  }
  if (subcommand === "delete" || subcommand === "rm") {
    const [key] = args;
    if (!key) {
      info("Usage: dpm config delete <key>");
      return 1;
    }
    delete config[key];
    writeConfig(config);
    return 0;
  }
  if (subcommand === "list" || subcommand === "ls") {
    for (const [k, v] of Object.entries(config))
      info(`${k}=${v}`);
    return 0;
  }
  info("Usage: dpm config <get|set|delete|list> ...");
  return 1;
};

// dist/cli/dpm.js
var HELP = `dpm \u2014 Dusk Package Manager

Usage:
  dpm install [packages...]     Install dependencies (alias: dpm i, dpm add)
  dpm uninstall <pkg>           Remove a package (alias: dpm rm, dpm remove)
  dpm run <script> [args...]    Run a package.json script
  dpm exec <command> [args...]  Run a local-bin command
  dpm list                      List installed packages
  dpm init [--yes]              Initialize a new package.json
  dpm cache <clean|verify|ls>   Manage the cache
  dpm config <get|set|delete> .. Manage config
  dpm --version                 Print dpm version
  dpm --help                    Show this help

Options:
  -D, --save-dev                Save to devDependencies
  -S, --save                    Save to dependencies (default)
  --silent                      Suppress output
  --registry <url>              Custom registry URL
`;
var parseFlags = (args) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq2 = a.indexOf("=");
      if (eq2 !== -1) {
        flags[a.slice(2, eq2)] = a.slice(eq2 + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else if (a.startsWith("-")) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};
var main = async (argv) => {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write("0.1.0\n");
    return 0;
  }
  const sub = args[0];
  const rest = args.slice(1);
  const { positional, flags } = parseFlags(rest);
  if (flags["silent"])
    setSilent(true);
  const cwd = flags["cwd"] ?? process.cwd();
  try {
    switch (sub) {
      case "install":
      case "i":
      case "add":
        return await installCommand({
          cwd,
          packages: positional,
          saveDev: !!flags["save-dev"] || !!flags["D"],
          ...flags["registry"] ? { registry: flags["registry"] } : {},
          noScripts: !!flags["ignore-scripts"],
          silent: !!flags["silent"]
        });
      case "uninstall":
      case "rm":
      case "remove":
      case "un":
        return await uninstallCommand({ cwd, packages: positional });
      case "run":
      case "run-script":
        if (positional.length === 0) {
          process.stderr.write("dpm run: missing script name\n");
          return 1;
        }
        return await runCommand({ cwd, script: positional[0], args: positional.slice(1) });
      case "exec":
        if (positional.length === 0) {
          process.stderr.write("dpm exec: missing command\n");
          return 1;
        }
        return await execCommand({ cwd, command: positional[0], args: positional.slice(1) });
      case "list":
      case "ls":
        return await listCommand({ cwd });
      case "init":
        return await initCommand({ cwd, yes: !!flags["yes"] || !!flags["y"] });
      case "cache":
        if (positional.length === 0) {
          process.stderr.write("dpm cache: missing subcommand\n");
          return 1;
        }
        return await cacheCommand(positional[0], positional.slice(1));
      case "config":
        if (positional.length === 0) {
          process.stderr.write("dpm config: missing subcommand\n");
          return 1;
        }
        return await configCommand(positional[0], positional.slice(1));
      default:
        process.stderr.write(`dpm: unknown command '${sub}'
`);
        process.stderr.write(HELP);
        return 1;
    }
  } catch (e) {
    process.stderr.write(`dpm: ${e.message}
`);
    return 1;
  }
};
if (typeof process !== "undefined" && process.argv) {
  void main(process.argv).then((code) => {
    if (process.exit)
      process.exit(code);
  }).catch((e) => {
    process.stderr.write(`dpm: ${e.message}
`);
    if (process.exit)
      process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
