'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');
const { Redactor } = require('../src/redact');
const { serializeError } = require('../src/errors');

function createFakeStream() {
  const chunks = [];
  return {
    isTTY: false,
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    get raw() {
      return chunks.join('');
    },
    get lines() {
      return chunks.join('').split('\n').filter(Boolean);
    },
  };
}

function createTestLogger(options = {}) {
  const stdout = createFakeStream();
  const stderr = createFakeStream();
  const log = createLogger({ ...options, stdout, stderr, timestamp: false, colors: false });
  return { log, stdout, stderr };
}

function hostileGetterError(prop) {
  const err = new Error('boom');
  Object.defineProperty(err, prop, {
    get() {
      throw new Error(`hostile ${prop} getter`);
    },
  });
  return err;
}

// --- hostile getters on the Error object itself (not just its extra props) ---

test('a hostile getter on error.name degrades to a safe default instead of crashing the log call', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  assert.doesNotThrow(() => log.error('request failed', hostileGetterError('name')));
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.name, 'Error');
});

test('a hostile getter on error.message degrades to a safe default instead of crashing the log call', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  assert.doesNotThrow(() => log.error('request failed', hostileGetterError('message')));
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.message, '');
});

test('a hostile getter on error.stack degrades gracefully instead of crashing the log call', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  assert.doesNotThrow(() => log.error('request failed', hostileGetterError('stack')));
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.error, 'stack'), false);
});

test('a hostile getter on error.cause degrades gracefully instead of crashing the log call', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  assert.doesNotThrow(() => log.error('request failed', hostileGetterError('cause')));
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.error, 'cause'), false);
});

test('a well-behaved error is completely unaffected by the hostile-getter guards', () => {
  const info = serializeError(new Error('plain failure'));
  assert.equal(info.name, 'Error');
  assert.equal(info.message, 'plain failure');
  assert.match(info.stack, /plain failure/);
});

// --- hostile constructor getter during redaction's plain-object check ---

test('a hostile constructor getter on a nested value is treated as an opaque leaf, not a crash', () => {
  const r = new Redactor(['password']);
  const evil = {};
  Object.defineProperty(evil, 'constructor', {
    get() {
      throw new Error('hostile constructor getter');
    },
  });
  const obj = { password: 'secret', evil };
  let result;
  assert.doesNotThrow(() => {
    result = r.redact(obj);
  });
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.evil, evil); // opaque leaf: passed through, not reflected into
});

// --- message-injection protection also covers metadata/context KEY names ---

test('pretty mode: a newline in a metadata KEY cannot forge an additional log line', () => {
  const { log, stdout } = createTestLogger();
  const meta = {};
  meta['ok\nFAKE fatal: system compromised'] = 'x';
  log.info('login attempt', meta);
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /ok\\nFAKE fatal/);
});

test('pretty mode: ANSI escapes in a metadata KEY are neutralized', () => {
  const { log, stdout } = createTestLogger();
  const meta = {};
  meta['\x1b[31mADMIN\x1b[0m'] = 'x';
  log.info('login attempt', meta);
  assert.doesNotMatch(stdout.lines[0], /\x1b/);
});

test('pretty mode: a newline in an Error extra-property KEY is neutralized too', () => {
  const { log, stderr } = createTestLogger();
  const err = new Error('failed');
  err['weird\nFAKE fatal: pwned'] = 'x';
  log.error('request failed', err);
  const bodyLines = stderr.raw.split('\n').filter(Boolean);
  assert.ok(bodyLines.every((line) => !/^FAKE fatal/.test(line)));
});

test('a normal metadata key with no control characters renders exactly as before', () => {
  const { log, stdout } = createTestLogger();
  log.info('login attempt', { username: 'raj' });
  assert.match(stdout.lines[0], /username=raj/);
});

test('JSON mode was already safe for key names and remains so', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  const meta = {};
  meta['ok\nFAKE'] = 'x';
  log.info('x', meta);
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed['ok\nFAKE'], 'x');
});
