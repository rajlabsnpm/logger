'use strict';

const DEFAULT_REPLACEMENT = '[REDACTED]';

const MAX_REDACT_DEPTH = 20;
const DEPTH_LIMIT_MARKER = '[Redaction depth limit exceeded]';


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
    return { paths: DEFAULT_REDACT_KEYS, replacement: DEFAULT_REPLACEMENT, errorProps: undefined };
  }

  if (Array.isArray(option)) {
    return { paths: option, replacement: DEFAULT_REPLACEMENT, errorProps: undefined };
  }

  if (typeof option === 'object') {
    const paths = option.paths === undefined ? [] : option.paths;
    if (!Array.isArray(paths)) {
      throw new TypeError('createLogger({ redact }) object form requires a "paths" array');
    }
    return {
      paths,
      replacement: typeof option.replacement === 'string' ? option.replacement : DEFAULT_REPLACEMENT,
      // Undefined means "not specified". The caller needs that distinction.
      errorProps: option.errorProps === undefined ? undefined : Boolean(option.errorProps),
    };
  }

  throw new TypeError(
    'createLogger({ redact }) must be `true`, an array of keys/paths, or { paths, replacement, errorProps }'
  );
}

/**
 * Redact rules come in two flavors:
 *   - plain key names like "password" match anywhere
 *   - dotted paths like "user.password" or "*.password" match a specific shape
 * We keep it simple on purpose; deep glob weirdness is a rabbit hole.
 */
class Redactor {
  constructor(option, replacementOverride) {
    const normalized = normalizeRedactOption(option);

    // Pass this along; logger.js handles the old option.
    this.errorPropsOption = normalized ? normalized.errorProps : undefined;

    if (!normalized) {
      this.enabled = false;
      return;
    }

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

    // No paths? No tree walk. Easy win.
    this.enabled = this.keyNames.size > 0 || this.pathPatterns.length > 0;
  }

  redact(value) {
    if (!this.enabled || value === null || typeof value !== 'object') return value;
    return this._redactValue(value, [], new Map(), 0);
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

  _redactValue(value, pathSegments, seen, depth) {
    if (value === null || typeof value !== 'object') return value;

    // Errors get their own special handling down in errors.js. We don't poke at them like regular objects.
    if (value instanceof Error) return value;

    if (depth > MAX_REDACT_DEPTH) return DEPTH_LIMIT_MARKER;

    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.set(value, true);
      return value.map((item, index) =>
        this._redactValue(item, pathSegments.concat(String(index)), seen, depth + 1)
      );
    }

    let isPlainObject;
    try {
      isPlainObject = value.constructor === Object || value.constructor === undefined;
    } catch (err) {
      // Weird constructor? Treat it like an opaque blob.
      isPlainObject = false;
    }
    if (!isPlainObject) {
      // Dates, Maps, Buffers, custom class stuff: treat them as opaque blobs.
      // We do not start digging through random prototypes like a raccoon in a dumpster.
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
      output[key] = this._redactValue(child, nextPath, seen, depth + 1);
    }
    return output;
  }
}

module.exports = { Redactor, DEFAULT_REDACT_KEYS, DEFAULT_REPLACEMENT, MAX_REDACT_DEPTH, DEPTH_LIMIT_MARKER };
