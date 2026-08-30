'use strict';

const util = require('util');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  // fatal gets a background so it's unmissable when scrolling past a wall of logs.
  bgRed: '\x1b[1m\x1b[97m\x1b[41m',
};

// The outer log envelope owns these names, so a colliding metadata/context
// key gets renamed instead of clobbering a core field in JSON mode.
const RESERVED_JSON_KEYS = new Set(['timestamp', 'level', 'message', 'name', 'error']);

function colorize(text, colorName) {
  const code = ANSI[colorName];
  if (!code) return text;
  return `${code}${text}${ANSI.reset}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatClockTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function safeString(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error) {
    return value.message || String(value);
  }
  try {
    return util.inspect(value, { depth: 4, breakLength: Infinity, compact: true });
  } catch (err) {
    return '[unserializable value]';
  }
}

// `duration` gets an "ms" suffix in pretty output (and stays a plain number
// in JSON) — see the Timers section in the README for why this one key is
// special-cased instead of a generic unit-formatting system.
function formatMetaValue(key, value) {
  if (key === 'duration' && typeof value === 'number') return `${value}ms`;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return value.name ? `[Function: ${value.name}]` : '[Function]';
  if (value instanceof Error) {
    return value.message ? `${value.name || 'Error'}: ${value.message}` : String(value);
  }
  try {
    return util.inspect(value, { depth: 4, breakLength: Infinity, compact: true });
  } catch (err) {
    return '[unserializable value]';
  }
}

// A manual key-by-key copy rather than Object.assign: Object.assign invokes
// getters as it copies, so a hostile getter on the source would throw before
// we even get to rendering. This way a single bad field degrades to
// "[unreadable]" instead of losing the whole log line.
function safeMergeInto(target, source) {
  if (!source) return;
  for (const key of Object.keys(source)) {
    try {
      target[key] = source[key];
    } catch (err) {
      target[key] = '[unreadable]';
    }
  }
}

// Context fields are ambient (request context, withContext); metadata is
// whatever was passed at the call site. Metadata wins on key collisions
// because it's the most specific, most deliberate thing the caller wrote.
function flattenFields(entry) {
  if (!entry.context && !entry.metadata) return null;
  const merged = {};
  safeMergeInto(merged, entry.context);
  safeMergeInto(merged, entry.metadata);
  return merged;
}

function formatMetaPretty(fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return '';
  return keys
    .map((key) => {
      let value;
      try {
        value = fields[key];
      } catch (err) {
        return `${key}=[unreadable]`;
      }
      return `${key}=${formatMetaValue(key, value)}`;
    })
    .join(' ');
}

function formatErrorPretty(info, indent) {
  const header = info.message ? `${info.name}: ${info.message}` : info.name;
  const body = info.stack || header;
  const lines = [body.split('\n').map((l) => indent + l).join('\n')];

  if (info.extra && Object.keys(info.extra).length > 0) {
    lines.push(indent + formatMetaPretty(info.extra));
  }
  if (info.cause) {
    lines.push(indent + 'Caused by:');
    lines.push(formatErrorPretty(info.cause, indent + '  '));
  }
  return lines.join('\n');
}

function formatPretty(entry, useColors, levels, labelWidth) {
  const { level, message, name, timestamp, error, source } = entry;
  const parts = [];

  if (timestamp) {
    const time = formatClockTime(timestamp);
    parts.push(useColors ? colorize(time, 'dim') : time);
  }

  const levelInfo = levels[level];
  const label = levelInfo.label.padEnd(labelWidth);
  parts.push(useColors ? colorize(label, levelInfo.color) : label);

  let messageSegment = '';
  if (name) {
    const nameTag = `[${name}]`;
    messageSegment += (useColors ? colorize(nameTag, 'dim') : nameTag) + ' ';
  }
  messageSegment += safeString(message === undefined ? '' : message);

  const fields = flattenFields(entry);
  if (fields) {
    const metaStr = formatMetaPretty(fields);
    if (metaStr) {
      messageSegment += '  ' + (useColors ? colorize(metaStr, 'dim') : metaStr);
    }
  }

  if (source) {
    const sourceTag = `[${source}]`;
    messageSegment += '  ' + (useColors ? colorize(sourceTag, 'dim') : sourceTag);
  }

  parts.push(messageSegment);
  let line = parts.join('  ');

  if (error) {
    const errorBody = formatErrorPretty(error, '  ');
    line += '\n' + (useColors ? colorize(errorBody, 'red') : errorBody);
  }

  return line;
}

function safeStringify(obj) {
  // Tiny safety net so a weird object doesn't take the whole logger down.
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, function replacer(key, value) {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (err) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: obj && obj.level,
      message: '[unserializable log entry]',
    });
  }
}

function formatJson(entry) {
  const { level, message, name, timestamp, error, source } = entry;

  const obj = {};
  if (timestamp) obj.timestamp = timestamp.toISOString();
  obj.level = level;
  if (name) obj.name = name;
  obj.message = message === undefined ? '' : message;

  const fields = flattenFields(entry);
  if (fields) {
    for (const key of Object.keys(fields)) {
      const safeKey = RESERVED_JSON_KEYS.has(key) ? `meta_${key}` : key;
      obj[safeKey] = fields[key];
    }
  }

  if (source) obj.source = source;
  if (error) obj.error = error;

  return safeStringify(obj);
}

module.exports = {
  formatPretty,
  formatJson,
  safeStringify,
  safeString,
  formatMetaPretty,
  formatMetaValue,
  flattenFields,
  RESERVED_JSON_KEYS,
};
