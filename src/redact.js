'use strict';

const DEFAULT_REPLACEMENT = '[REDACTED]';

// A reasonable "turn this on and stop worrying about it" default list.
// Deliberately conservative — we'd rather miss an exotic field name than
// redact something a developer actually wanted to see in their logs.
const DEFAULT_REDACT_KEYS = [
  'password',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'clientsecret',
  'privatekey',
];

function normalizeRedactOption(option) {
  if (!option) return null;

  if (option === true) {
    return { paths: DEFAULT_REDACT_KEYS, replacement: DEFAULT_REPLACEMENT };
  }

  if (Array.isArray(option)) {
    return { paths: option, replacement: DEFAULT_REPLACEMENT };
  }

  if (typeof option === 'object') {
    if (!Array.isArray(option.paths)) {
      throw new TypeError('createLogger({ redact }) object form requires a "paths" array');
    }
    return {
      paths: option.paths,
      replacement: typeof option.replacement === 'string' ? option.replacement : DEFAULT_REPLACEMENT,
    };
  }

  throw new TypeError(
    'createLogger({ redact }) must be `true`, an array of keys/paths, or { paths, replacement }'
  );
}

/**
 * Rules come in two flavors:
 *   - a bare key name ("password") matches that key at ANY depth
 *   - a dotted path ("user.password", "*.password") matches only that exact
 *     shape, with "*" acting as a single-segment wildcard
 * There's no deep/glob wildcard support on purpose — see README for why.
 */
class Redactor {
  constructor(option, replacementOverride) {
    const normalized = normalizeRedactOption(option);
    this.enabled = Boolean(normalized);
    if (!this.enabled) return;

    this.replacement =
      typeof replacementOverride === 'string' ? replacementOverride : normalized.replacement;
    this.keyNames = new Set();
    this.pathPatterns = [];

    for (const rule of normalized.paths) {
      if (typeof rule !== 'string' || rule.length === 0) {
        throw new TypeError(`Invalid redact rule: ${JSON.stringify(rule)}`);
      }
      if (rule.includes('.')) {
        this.pathPatterns.push(rule.toLowerCase().split('.'));
      } else {
        this.keyNames.add(rule.toLowerCase());
      }
    }
  }

  redact(value) {
    if (!this.enabled || value === null || typeof value !== 'object') return value;
    return this._redactValue(value, [], new Map());
  }

  _matchesPath(pathSegments) {
    for (const pattern of this.pathPatterns) {
      if (pattern.length !== pathSegments.length) continue;
      let matched = true;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== '*' && pattern[i] !== pathSegments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  }

  _shouldRedactKey(key, pathSegments) {
    if (this.keyNames.has(key.toLowerCase())) return true;
    if (this.pathPatterns.length > 0 && this._matchesPath(pathSegments)) return true;
    return false;
  }

  _redactValue(value, pathSegments, seen) {
    if (value === null || typeof value !== 'object') return value;

    // Errors get their own dedicated serialization/redaction pass in errors.js.
    if (value instanceof Error) return value;

    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.set(value, true);
      return value.map((item, index) => this._redactValue(item, pathSegments.concat(String(index)), seen));
    }

    const isPlainObject = value.constructor === Object || value.constructor === undefined;
    if (!isPlainObject) {
      // Dates, Maps, Buffers, class instances, etc. We treat these as opaque
      // leaves rather than reflecting into them — poking at arbitrary
      // prototypes to find "password"-shaped fields is a good way to trip a
      // hostile getter or leak something we don't understand.
      return value;
    }

    if (seen.has(value)) return '[Circular]';
    seen.set(value, true);

    const output = {};
    for (const key of Object.keys(value)) {
      const nextPath = pathSegments.concat(key.toLowerCase());
      if (this._shouldRedactKey(key, nextPath)) {
        output[key] = this.replacement;
        continue;
      }

      let child;
      try {
        child = value[key];
      } catch (err) {
        output[key] = '[unreadable]';
        continue;
      }
      output[key] = this._redactValue(child, nextPath, seen);
    }
    return output;
  }
}

module.exports = { Redactor, DEFAULT_REDACT_KEYS, DEFAULT_REPLACEMENT };
