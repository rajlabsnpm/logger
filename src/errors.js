'use strict';

const { Redactor, DEFAULT_REDACT_KEYS } = require('./redact');

const CORE_ERROR_KEYS = new Set(['name', 'message', 'stack', 'cause']);
const MAX_CAUSE_DEPTH = 10;

// This is the "please don't leak auth junk from weird error objects" safety net. Some libraries glue secrets onto Error instances like glitter on a toddler. Turn off redactErrorProps if you really want that chaos.
const DEFAULT_EXTRA_REDACTOR = new Redactor(DEFAULT_REDACT_KEYS);

function safeStringifyPrimitive(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  try {
    return String(value);
  } catch (err) {
    return '[unserializable]';
  }
}

function redactExtras(extra, userRedactor, redactErrorProps) {
  let result = extra;
  if (redactErrorProps !== false) {
    result = DEFAULT_EXTRA_REDACTOR.redact(result);
  }
  if (userRedactor && userRedactor.enabled) {
    result = userRedactor.redact(result);
  }
  return result;
}

function serializeError(error, options = {}, depth = 0) {
  if (depth > MAX_CAUSE_DEPTH) {
    return { name: 'Error', message: '[cause chain truncated]' };
  }

  if (!(error instanceof Error)) {
    return { name: 'Error', message: safeStringifyPrimitive(error) };
  }

  const info = {
    name: error.name || 'Error',
    message: error.message || '',
  };

  if (typeof error.stack === 'string') info.stack = error.stack;

  const extraKeys = Object.keys(error).filter((key) => !CORE_ERROR_KEYS.has(key));
  if (extraKeys.length > 0) {
    const extra = {};
    for (const key of extraKeys) {
      try {
        extra[key] = error[key];
      } catch (err) {
        extra[key] = '[unreadable]';
      }
    }
    info.extra = redactExtras(extra, options.redactor, options.redactErrorProps);
  }

  if (error.cause !== undefined) {
    info.cause = serializeError(error.cause, options, depth + 1);
  }

  return info;
}

module.exports = { serializeError };
