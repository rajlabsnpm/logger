'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');
const { Sampler, validateSamplingOption } = require('../src/sampling');

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
  const log = createLogger({ ...options, stdout, stderr, timestamp: false });
  return { log, stdout, stderr };
}

// --- production JSON mode -----------------------------------------------

test('JSON entries flatten context and metadata onto the top level', () => {
  const { log, stdout } = createTestLogger({ format: 'json', name: 'API' });
  log.withContext({ requestId: 'req_123' }).info('Request completed', {
    method: 'GET',
    path: '/users',
    status: 200,
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'req_123');
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.path, '/users');
  assert.equal(parsed.status, 200);
  assert.equal(parsed.name, 'API');
});

test('duration stays a raw number in JSON mode (unlike the "ms"-suffixed pretty mode)', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  log.info('done', { duration: 42 });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.duration, 42);
  assert.equal(typeof parsed.duration, 'number');
});

// --- sampling --------------------------------------------------------

test('Sampler.allows() with no configured rate for a level always allows it', () => {
  const s = new Sampler({ debug: 0.5 });
  assert.equal(s.allows('error'), true);
});

test('Sampler.allows() deterministically emits ~1/N of messages for rate 1/N', () => {
  const s = new Sampler({ debug: 0.1 });
  let allowed = 0;
  for (let i = 0; i < 100; i++) {
    if (s.allows('debug')) allowed++;
  }
  assert.equal(allowed, 10);
});

test('Sampler.allows() with rate 1 always allows', () => {
  const s = new Sampler({ debug: 1 });
  for (let i = 0; i < 20; i++) assert.equal(s.allows('debug'), true);
});

test('Sampler.allows() with rate 0 never allows', () => {
  const s = new Sampler({ debug: 0 });
  for (let i = 0; i < 20; i++) assert.equal(s.allows('debug'), false);
});

test('sampling is applied end-to-end through the logger for a configured level', () => {
  const { log, stdout } = createTestLogger({ sampling: { debug: 0.25 } });
  for (let i = 0; i < 20; i++) log.debug('noisy');
  assert.equal(stdout.lines.length, 5);
});

test('errors are never sampled unless explicitly configured', () => {
  const { log, stderr } = createTestLogger({ sampling: { debug: 0 } });
  for (let i = 0; i < 5; i++) log.error('important');
  assert.equal(stderr.lines.length, 5);
});

test('validateSamplingOption rejects an out-of-range rate', () => {
  assert.throws(() => validateSamplingOption({ debug: 1.5 }), TypeError);
  assert.throws(() => validateSamplingOption({ debug: -0.1 }), TypeError);
  assert.throws(() => validateSamplingOption({ debug: 'high' }), TypeError);
});

test('createLogger({ sampling }) validates at construction time', () => {
  assert.throws(() => createLogger({ sampling: { debug: 2 } }), TypeError);
  assert.throws(() => createLogger({ sampling: 'nope' }), TypeError);
});

// --- source location -----------------------------------------------------

test('source location is omitted by default', () => {
  const { log, stdout } = createTestLogger();
  log.info('no source');
  assert.doesNotMatch(stdout.lines[0], /\[.*:\d+\]/);
});

test('source: true adds a "[file:line]" tag pointing at the caller', () => {
  const { log, stdout } = createTestLogger({ source: true });
  log.info('with source');
  assert.match(stdout.lines[0], /\[.*v1\.5-production\.test\.js:\d+\]/);
});

test('source: true also appears in JSON mode as a "source" field', () => {
  const { log, stdout } = createTestLogger({ source: true, format: 'json' });
  log.info('with source');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.match(parsed.source, /v1\.5-production\.test\.js:\d+/);
});

// --- error causes and extra properties -----------------------------------

test('an Error with a cause chain serializes both levels', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  const inner = new Error('conn refused');
  const outer = new Error('query failed', { cause: inner });
  log.error('Query failed', outer);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.message, 'query failed');
  assert.equal(parsed.error.cause.message, 'conn refused');
});

test('custom Error subclasses serialize with their own name', () => {
  class ValidationError extends TypeError {
    constructor(msg) {
      super(msg);
      this.name = 'ValidationError';
    }
  }
  const { log, stderr } = createTestLogger({ format: 'json' });
  log.error('bad input', new ValidationError('field required'));
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.name, 'ValidationError');
  assert.equal(parsed.error.message, 'field required');
});

test('custom own properties on an Error are preserved under error.extra', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  const err = new Error('failed');
  err.code = 'ECONNREFUSED';
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.code, 'ECONNREFUSED');
});

test('sensitive-looking custom Error properties are redacted by default, even without a redact config', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  const err = new Error('request failed');
  err.config = { headers: { authorization: 'Bearer secret-token' } };
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.config.headers.authorization, '[REDACTED]');
});

test('redactErrorProps: false disables the automatic error-property scrub', () => {
  const { log, stderr } = createTestLogger({ format: 'json', redactErrorProps: false });
  const err = new Error('request failed');
  err.token = 'raw-token-value';
  log.error('x', err);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.error.extra.token, 'raw-token-value');
});

// --- configuration validation ----------------------------------------------

test('an invalid level string falls back to the default rather than throwing', () => {
  assert.doesNotThrow(() => createLogger({ level: 'nonsense' }));
  const log = createLogger({ level: 'nonsense' });
  assert.equal(log.level, 'debug');
});

test('an invalid format string falls back to pretty rather than throwing', () => {
  const log = createLogger({ format: 'xml' });
  assert.equal(log.format, 'pretty');
});

test('structural misconfiguration (levels/redact/sampling/transports/hooks) throws synchronously', () => {
  assert.throws(() => createLogger({ levels: { debug: 'bad' } }), TypeError);
  assert.throws(() => createLogger({ redact: 123 }), TypeError);
  assert.throws(() => createLogger({ sampling: { debug: 5 } }), TypeError);
  assert.throws(() => createLogger({ transports: [{}] }), TypeError);
  assert.throws(() => createLogger({ hooks: { before: 1 } }), TypeError);
});

// --- edge cases: values that must never crash the logger ------------------

test('every unusual value type can be logged without throwing, in both formats', () => {
  for (const format of ['pretty', 'json']) {
    const { log } = createTestLogger({ format });
    const circular = { a: 1 };
    circular.self = circular;

    const poison = {};
    Object.defineProperty(poison, 'boom', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });

    const values = [
      undefined,
      null,
      'a string',
      42,
      true,
      10n,
      Symbol('x'),
      function namedFn() {},
      [1, 2, 3],
      { nested: { deep: { value: true } } },
      circular,
      new Error('plain error'),
      new TypeError('type error'),
      poison,
      Object.create(null),
      {},
      [],
      '',
      { getter: 1, get computed() { return 2; } },
      { toJSON: () => 'custom' },
    ];

    for (const value of values) {
      assert.doesNotThrow(() => log.info('edge case', value));
    }
  }
});

test('an extremely large string does not crash the logger', () => {
  const { log } = createTestLogger();
  const huge = 'x'.repeat(200000);
  assert.doesNotThrow(() => log.info(huge));
});

test('deeply nested objects do not crash the logger', () => {
  const { log } = createTestLogger({ format: 'json' });
  let obj = { value: 'leaf' };
  for (let i = 0; i < 50; i++) obj = { nested: obj };
  assert.doesNotThrow(() => log.info('deep', obj));
});

// --- mutation safety -------------------------------------------------------

test('logging metadata never mutates the caller-provided object, redaction on or off', () => {
  for (const redact of [undefined, ['password']]) {
    const { log } = createTestLogger({ redact });
    const data = { password: 'secret', nested: { value: 1 } };
    log.info('User', data);
    assert.equal(data.password, 'secret');
    assert.equal(data.nested.value, 1);
  }
});
