'use strict';

const util = require('util');
const { LEVELS } = require('./levels');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const LABEL_WIDTH = Math.max(...Object.values(LEVELS).map((entry) => entry.label.length));

// the outer log envelope already owns these names, so we rename payload keys instead of clobbering them.
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

function formatMetaValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error) {
    return value.message ? `${value.name || 'Error'}: ${value.message}` : String(value);
  }
  try {
    return util.inspect(value, { depth: 4, breakLength: Infinity, compact: true });
  } catch (err) {
    return '[unserializable value]';
  }
}

function formatMetaPretty(meta) {
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';
  return keys.map((key) => `${key}=${formatMetaValue(meta[key])}`).join(' ');
}

function extractErrorInfo(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || '',
      stack: typeof error.stack === 'string' ? error.stack : null,
    };
  }
  return { name: 'Error', message: safeString(error), stack: null };
}

function normalizeMeta(meta) {
  if (meta === undefined || meta === null) return { meta: null, error: null };
  if (meta instanceof Error) return { meta: null, error: meta };
  if (typeof meta === 'object' && !Array.isArray(meta)) return { meta, error: null };
  if (Array.isArray(meta)) return { meta: { items: meta }, error: null };
  return { meta: { value: meta }, error: null };
}

function formatPretty(entry, useColors) {
  const { level, message, meta, name, timestamp } = entry;
  const { meta: metaObj, error } = normalizeMeta(meta);
  const parts = [];

  if (timestamp !== false) {
    const time = formatClockTime(new Date());
    parts.push(useColors ? colorize(time, 'dim') : time);
  }

  const levelInfo = LEVELS[level];
  const label = levelInfo.label.padEnd(LABEL_WIDTH);
  parts.push(useColors ? colorize(label, levelInfo.color) : label);

  let messageSegment = '';
  if (name) {
    const nameTag = `[${name}]`;
    messageSegment += (useColors ? colorize(nameTag, 'dim') : nameTag) + ' ';
  }
  messageSegment += safeString(message === undefined ? '' : message);

  if (metaObj) {
    const metaStr = formatMetaPretty(metaObj);
    if (metaStr) {
      messageSegment += '  ' + (useColors ? colorize(metaStr, 'dim') : metaStr);
    }
  }

  parts.push(messageSegment);
  let line = parts.join('  ');

  if (error) {
    const info = extractErrorInfo(error);
    const body = info.stack || `${info.name}: ${info.message}`;
    const indented = body
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n');
    line += '\n' + (useColors ? colorize(indented, 'red') : indented);
  }

  return line;
}

function safeStringify(obj) {
  // tiny safety net so a weird object doesn't take the whole logger down.
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, function replacer(key, value) {
      if (value instanceof Error) {
        return extractErrorInfo(value);
      }
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
  const { level, message, meta, name, timestamp } = entry;
  const { meta: metaObj, error } = normalizeMeta(meta);

  const obj = {};
  if (timestamp !== false) {
    obj.timestamp = new Date().toISOString();
  }
  obj.level = level;
  if (name) obj.name = name;
  obj.message = message === undefined ? '' : message;

  if (metaObj) {
    for (const key of Object.keys(metaObj)) {
      const safeKey = RESERVED_JSON_KEYS.has(key) ? `meta_${key}` : key;
      obj[safeKey] = metaObj[key];
    }
  }

  if (error) {
    obj.error = extractErrorInfo(error);
  }

  return safeStringify(obj);
}

module.exports = {
  formatPretty,
  formatJson,
  safeStringify,
  safeString,
  formatMetaPretty,
  formatMetaValue,
  extractErrorInfo,
  normalizeMeta,
  LABEL_WIDTH,
};
