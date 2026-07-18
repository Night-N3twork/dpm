// Minimal semver implementation for dpm.
// Supports: parse, compare, satisfies (operators: ~ ^ > >= < <= = || space-AND, with-or-without-space between op and ver),
// hyphen ranges (1.0 - 2.0), x-ranges (1.x.x, 1.2.x, 1, 1.2), bare-major/minor (1, 1.2), and maxSatisfying.
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
export const parse = (version) => {
    const m = SEMVER_RE.exec(version.trim());
    if (!m)
        return null;
    return {
        major: parseInt(m[1], 10),
        minor: parseInt(m[2], 10),
        patch: parseInt(m[3], 10),
        prerelease: m[4] ? m[4].split('.') : [],
        build: m[5] ? m[5].split('.') : [],
        raw: version,
    };
};
export const valid = (version) => parse(version) !== null;
// Returns -1 if a < b, 0 if equal, 1 if a > b
export const compare = (a, b) => {
    const av = typeof a === 'string' ? parse(a) : a;
    const bv = typeof b === 'string' ? parse(b) : b;
    if (!av || !bv)
        return 0;
    if (av.major !== bv.major)
        return av.major > bv.major ? 1 : -1;
    if (av.minor !== bv.minor)
        return av.minor > bv.minor ? 1 : -1;
    if (av.patch !== bv.patch)
        return av.patch > bv.patch ? 1 : -1;
    // Prerelease: a version with prerelease is LESS than one without
    if (av.prerelease.length === 0 && bv.prerelease.length === 0)
        return 0;
    if (av.prerelease.length === 0)
        return 1;
    if (bv.prerelease.length === 0)
        return -1;
    // Compare prerelease identifiers
    for (let i = 0; i < Math.max(av.prerelease.length, bv.prerelease.length); i++) {
        const ai = av.prerelease[i];
        const bi = bv.prerelease[i];
        if (ai === undefined)
            return -1;
        if (bi === undefined)
            return 1;
        const aNum = /^\d+$/.test(ai);
        const bNum = /^\d+$/.test(bi);
        if (aNum && bNum) {
            const an = parseInt(ai, 10);
            const bn = parseInt(bi, 10);
            if (an !== bn)
                return an > bn ? 1 : -1;
        }
        else if (aNum)
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
export const gt = (a, b) => compare(a, b) === 1;
export const gte = (a, b) => compare(a, b) >= 0;
export const lt = (a, b) => compare(a, b) === -1;
export const lte = (a, b) => compare(a, b) <= 0;
export const eq = (a, b) => compare(a, b) === 0;
const toComparator = (op, ver) => {
    const target = parse(ver);
    if (!target)
        return () => false;
    switch (op) {
        case '=':
        case '': return (v) => eq(v, target);
        case '>': return (v) => gt(v, target);
        case '>=': return (v) => gte(v, target);
        case '<': return (v) => lt(v, target);
        case '<=': return (v) => lte(v, target);
        default: return () => false;
    }
};
const X_TOKEN_RE = /^[xX*]$/;
const parsePartial = (raw) => {
    let s = raw.trim();
    if (s.startsWith('v') || s.startsWith('V'))
        s = s.slice(1);
    if (s === '' || s === '*' || s === 'x' || s === 'X') {
        return { major: null, minor: null, patch: null, prerelease: [] };
    }
    let prerelease = [];
    const dashIdx = s.indexOf('-');
    const plusIdx = s.indexOf('+');
    let core = s;
    if (dashIdx >= 0) {
        core = s.slice(0, dashIdx);
        const tail = s.slice(dashIdx + 1);
        const tailEnd = plusIdx > dashIdx ? plusIdx - dashIdx - 1 : tail.length;
        prerelease = tail.slice(0, tailEnd).split('.');
    }
    else if (plusIdx >= 0) {
        core = s.slice(0, plusIdx);
    }
    const segs = core.split('.');
    if (segs.length === 0 || segs.length > 3)
        return null;
    const parseSeg = (seg) => {
        if (seg === undefined)
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
    if (segs[0] !== undefined && !X_TOKEN_RE.test(segs[0]) && major === null)
        return null;
    return { major, minor, patch, prerelease };
};
const partialToFull = (p, fillUpper) => {
    const M = p.major ?? (fillUpper ? 0 : 0);
    const m = p.minor ?? (fillUpper ? 0 : 0);
    const pa = p.patch ?? (fillUpper ? 0 : 0);
    const pre = p.prerelease.length > 0 ? '-' + p.prerelease.join('.') : '';
    return `${M}.${m}.${pa}${pre}`;
};
const caretRange = (raw) => {
    const target = parsePartial(raw);
    if (!target)
        return [() => false];
    if (target.major === null)
        return [() => true];
    const lo = partialToFull({
        major: target.major,
        minor: target.minor ?? 0,
        patch: target.patch ?? 0,
        prerelease: target.prerelease,
    }, false);
    let hi;
    if (target.major > 0 || target.minor === null) {
        hi = `${target.major + 1}.0.0-0`;
    }
    else if (target.minor > 0 || target.patch === null) {
        hi = `0.${target.minor + 1}.0-0`;
    }
    else {
        hi = `0.0.${(target.patch ?? 0) + 1}-0`;
    }
    return [toComparator('>=', lo), toComparator('<', hi)];
};
const tildeRange = (raw) => {
    const target = parsePartial(raw);
    if (!target)
        return [() => false];
    if (target.major === null)
        return [() => true];
    const lo = partialToFull({
        major: target.major,
        minor: target.minor ?? 0,
        patch: target.patch ?? 0,
        prerelease: target.prerelease,
    }, false);
    const hi = target.minor === null
        ? `${target.major + 1}.0.0-0`
        : `${target.major}.${target.minor + 1}.0-0`;
    return [toComparator('>=', lo), toComparator('<', hi)];
};
const xRange = (raw) => {
    const target = parsePartial(raw);
    if (!target)
        return [() => false];
    if (target.major === null)
        return [() => true];
    if (target.minor === null) {
        return [
            toComparator('>=', `${target.major}.0.0`),
            toComparator('<', `${target.major + 1}.0.0-0`),
        ];
    }
    if (target.patch === null) {
        return [
            toComparator('>=', `${target.major}.${target.minor}.0`),
            toComparator('<', `${target.major}.${target.minor + 1}.0-0`),
        ];
    }
    return [toComparator('=', partialToFull(target, false))];
};
const tokenizeRange = (range) => {
    // Glue an operator to its following version: ">= 1.2.3" → ">=1.2.3"
    // Keeps hyphen ranges intact: "1.0 - 2.0" stays three tokens
    const tokens = [];
    let i = 0;
    while (i < range.length) {
        if (/\s/.test(range[i])) {
            i++;
            continue;
        }
        let tok = '';
        if (range[i] === '>' || range[i] === '<') {
            tok += range[i++];
            if (range[i] === '=')
                tok += range[i++];
            while (i < range.length && /\s/.test(range[i]))
                i++;
            while (i < range.length && !/\s/.test(range[i]))
                tok += range[i++];
        }
        else if (range[i] === '=' || range[i] === '~' || range[i] === '^') {
            tok += range[i++];
            while (i < range.length && /\s/.test(range[i]))
                i++;
            while (i < range.length && !/\s/.test(range[i]))
                tok += range[i++];
        }
        else if (range[i] === '-' && tok === '') {
            tok = '-';
            i++;
        }
        else {
            while (i < range.length && !/\s/.test(range[i]))
                tok += range[i++];
        }
        if (tok !== '')
            tokens.push(tok);
    }
    return tokens;
};
const expandRange = (range) => {
    range = range.trim();
    if (range === '' || range === '*' || range === 'latest' || range === 'x' || range === 'X') {
        return [() => true];
    }
    // Hyphen range: A - B   (with spaces required by spec)
    const hyphenMatch = /^([^\s]+)\s+-\s+([^\s]+)$/.exec(range);
    if (hyphenMatch) {
        const lo = parsePartial(hyphenMatch[1]);
        const hi = parsePartial(hyphenMatch[2]);
        if (!lo || !hi)
            return [() => false];
        const loStr = partialToFull({ major: lo.major ?? 0, minor: lo.minor ?? 0, patch: lo.patch ?? 0, prerelease: lo.prerelease }, false);
        let hiCmp;
        if (hi.minor === null) {
            hiCmp = toComparator('<', `${(hi.major ?? 0) + 1}.0.0-0`);
        }
        else if (hi.patch === null) {
            hiCmp = toComparator('<', `${hi.major ?? 0}.${hi.minor + 1}.0-0`);
        }
        else {
            hiCmp = toComparator('<=', partialToFull(hi, false));
        }
        return [toComparator('>=', loStr), hiCmp];
    }
    if (range.startsWith('^'))
        return caretRange(range.slice(1));
    if (range.startsWith('~'))
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
                comparators.push(op === '<' || op === '<=' ? () => false : () => true);
                continue;
            }
            // For partial versions in >= / < / <=, expand to bounds
            if (partial.minor === null || partial.patch === null) {
                if (op === '>=' || op === '>') {
                    const lo = partialToFull({ major: partial.major, minor: partial.minor ?? 0, patch: partial.patch ?? 0, prerelease: partial.prerelease }, false);
                    comparators.push(toComparator(op, lo));
                }
                else if (op === '<' || op === '<=') {
                    if (partial.minor === null) {
                        comparators.push(toComparator('<', `${partial.major + (op === '<=' ? 1 : 0)}.0.0-0`));
                    }
                    else {
                        comparators.push(toComparator('<', `${partial.major}.${partial.minor + (op === '<=' ? 1 : 0)}.0-0`));
                    }
                }
                else {
                    // = with partial → x-range
                    for (const c of xRange(verRaw))
                        comparators.push(c);
                }
                continue;
            }
            comparators.push(toComparator(op, partialToFull(partial, false)));
            continue;
        }
        if (tok.startsWith('^')) {
            for (const c of caretRange(tok.slice(1)))
                comparators.push(c);
            continue;
        }
        if (tok.startsWith('~')) {
            for (const c of tildeRange(tok.slice(1)))
                comparators.push(c);
            continue;
        }
        // Bare token: try x-range / partial
        for (const c of xRange(tok))
            comparators.push(c);
    }
    return comparators;
};
// Extract version strings explicitly mentioned in a comparator-set (for prerelease gate).
const extractMentionedVersions = (range) => {
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
// Range may have || alternatives
export const satisfies = (version, range, opts = {}) => {
    const v = parse(version);
    if (!v)
        return false;
    for (const alt of range.split('||')) {
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
export const maxSatisfying = (versions, range) => {
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
export const minSatisfying = (versions, range) => {
    let best = null;
    let bestStr = null;
    for (const ver of versions) {
        if (!satisfies(ver, range))
            continue;
        const parsed = parse(ver);
        if (!parsed)
            continue;
        if (!best || lt(parsed, best)) {
            best = parsed;
            bestStr = ver;
        }
    }
    return bestStr;
};
//# sourceMappingURL=index.js.map