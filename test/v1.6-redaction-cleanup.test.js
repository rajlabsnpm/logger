'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');

function createFakeStream() {
  const chunks = [];
  return {
    isTTY: false,
    write(chunk) {
      chunks.push(chunk);
      return true;
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

function withStderrSpy(fn) {
  const original = process.stderr.write;
  const chunks = [];
  process.stderr.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

// Must run first in this file: warnOnce() dedupes the deprecation notice
// process-wide, so this is the only place we can reliably observe it firing.
test('using the deprecated top-level redactErrorProps emits a one-time deprecation warning', () => {
  const captured = withStderrSpy(() => {
    createLogger({ redactErrorProps: false });
  });
  assert.match(captured, /redactErrorProps.*deprecated/s);
  assert.match(captured, /redact: \{ errorProps: false \}/);
});

test('a second use of the deprecated option does not warn again', () => {
  const captured = withStderrSpy(() => {
    createLogger({ redactErrorProps: false });
  });
  assert.equal(captured, '');
});

test('redact: { errorProps: false } behaves identically to the old redactErrorProps: false', () => {
  const { log, stderr } = createTestLogger({ format: 'json', redact: { errorProps: false } });
  const err = new Error('request failed');
  err.token = 'raw-token-value';
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.token, 'raw-token-value');
});

test('redact: { errorProps: false } with no paths does not enable context/metadata redaction at all', () => {
  const { log } = createTestLogger({ redact: { errorProps: false } });
  assert.equal(log._core.redactor.enabled, false);
});

test('the default (neither option supplied) still scrubs error extras against the built-in list', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  const err = new Error('request failed');
  err.config = { headers: { authorization: 'Bearer secret-token' } };
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.config.headers.authorization, '[REDACTED]');
});

test('when both the old and new options are given, redact.errorProps (the new one) wins', () => {
  const { log, stderr } = createTestLogger({
    format: 'json',
    redactErrorProps: true,
    redact: { errorProps: false },
  });
  const err = new Error('request failed');
  err.token = 'raw-token-value';
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.token, 'raw-token-value');
});

test('redact: { paths: [...] } continues to apply to error extras regardless of errorProps', () => {
  const { log, stderr } = createTestLogger({
    format: 'json',
    redact: { paths: ['nonstandard-secret'], errorProps: false },
  });
  const err = new Error('request failed');
  err['nonstandard-secret'] = 'hide-me';
  err.token = 'left-alone-by-errorProps-false';
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra['nonstandard-secret'], '[REDACTED]');
  assert.equal(parsed.error.extra.token, 'left-alone-by-errorProps-false');
});

test('redact: {} (no paths, no errorProps) is a harmless no-op rather than throwing', () => {
  assert.doesNotThrow(() => createLogger({ redact: {} }));
  const { log } = createTestLogger({ redact: {} });
  assert.equal(log._core.redactor.enabled, false);
});

test('redact: { paths: "nope" } (wrong type) still throws, same as before', () => {
  assert.throws(() => createLogger({ redact: { paths: 'not-an-array' } }), TypeError);
});

test('context/metadata redaction is completely unaffected by the errorProps cleanup', () => {
  const { log, stdout } = createTestLogger({
    format: 'json',
    redact: ['password'],
  });
  log.info('login', { username: 'raj', password: 'secret' });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.username, 'raj');
});
