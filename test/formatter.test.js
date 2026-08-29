'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatPretty,
  formatJson,
  safeStringify,
  formatMetaPretty,
  formatMetaValue,
  normalizeMeta,
  extractErrorInfo,
} = require('../src/formatter');

test('formatPretty includes a HH:MM:SS timestamp by default', () => {
  const line = formatPretty({ level: 'info', message: 'hello', name: '', timestamp: true });
  assert.match(line, /^\d{2}:\d{2}:\d{2}\s\s/);
});

test('formatPretty omits the timestamp when disabled', () => {
  const line = formatPretty({ level: 'info', message: 'hello', name: '', timestamp: false });
  assert.doesNotMatch(line, /^\d{2}:\d{2}:\d{2}/);
  assert.match(line, /^INFO/);
});

test('formatPretty right-pads level labels so they line up', () => {
  const info = formatPretty({ level: 'info', message: 'x', timestamp: false });
  const success = formatPretty({ level: 'success', message: 'x', timestamp: false });
  assert.equal(info.indexOf('x'), success.indexOf('x'));
});

test('formatPretty shows the namespace when a name is set', () => {
  const line = formatPretty({ level: 'info', message: 'started', name: 'API', timestamp: false });
  assert.match(line, /\[API\]/);
  assert.match(line, /started/);
});

test('formatPretty renders metadata as key=value pairs', () => {
  const line = formatPretty({
    level: 'info',
    message: 'Server started',
    meta: { port: 3000, environment: 'production' },
    timestamp: false,
  });
  assert.match(line, /port=3000/);
  assert.match(line, /environment=production/);
});

test('formatPretty handles an Error passed as metadata', () => {
  const error = new Error('boom');
  const line = formatPretty({ level: 'error', message: 'failed', meta: error, timestamp: false });
  assert.match(line, /failed/);
  assert.match(line, /Error: boom/);
});

test('formatPretty never throws on circular metadata', () => {
  const circular = { name: 'obj' };
  circular.self = circular;
  assert.doesNotThrow(() => {
    formatPretty({ level: 'info', message: 'circular test', meta: circular, timestamp: false });
  });
});

test('formatPretty handles empty and undefined messages without throwing', () => {
  assert.doesNotThrow(() => formatPretty({ level: 'info', message: '', timestamp: false }));
  assert.doesNotThrow(() => formatPretty({ level: 'info', message: undefined, timestamp: false }));
  assert.doesNotThrow(() => formatPretty({ level: 'info', message: null, timestamp: false }));
});

test('formatMetaValue formats primitives, strings with spaces, and objects', () => {
  assert.equal(formatMetaValue(42), '42');
  assert.equal(formatMetaValue(true), 'true');
  assert.equal(formatMetaValue(null), 'null');
  assert.equal(formatMetaValue(undefined), 'undefined');
  assert.equal(formatMetaValue('nospaces'), 'nospaces');
  assert.equal(formatMetaValue('has spaces'), '"has spaces"');
  assert.match(formatMetaValue([1, 2, 3]), /1, 2, 3/);
});

test('formatMetaPretty joins multiple keys with spaces', () => {
  const result = formatMetaPretty({ a: 1, b: 'two' });
  assert.equal(result, 'a=1 b=two');
});

test('normalizeMeta distinguishes errors, objects, arrays and primitives', () => {
  const err = new Error('x');
  assert.deepEqual(normalizeMeta(err), { meta: null, error: err });
  assert.deepEqual(normalizeMeta({ a: 1 }), { meta: { a: 1 }, error: null });
  assert.deepEqual(normalizeMeta(undefined), { meta: null, error: null });
  assert.deepEqual(normalizeMeta(null), { meta: null, error: null });
  assert.deepEqual(normalizeMeta([1, 2]), { meta: { items: [1, 2] }, error: null });
  assert.deepEqual(normalizeMeta('oops'), { meta: { value: 'oops' }, error: null });
});

test('extractErrorInfo pulls name, message and stack off an Error', () => {
  const err = new TypeError('bad type');
  const info = extractErrorInfo(err);
  assert.equal(info.name, 'TypeError');
  assert.equal(info.message, 'bad type');
  assert.match(info.stack, /TypeError: bad type/);
});

test('formatJson produces valid, parseable JSON with the documented shape', () => {
  const line = formatJson({
    level: 'info',
    message: 'Server started',
    meta: { port: 3000 },
    name: '',
    timestamp: true,
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'Server started');
  assert.equal(parsed.port, 3000);
  assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('formatJson omits the timestamp field when disabled', () => {
  const parsed = JSON.parse(formatJson({ level: 'info', message: 'hi', timestamp: false }));
  assert.equal('timestamp' in parsed, false);
});

test('formatJson includes the namespace when present', () => {
  const parsed = JSON.parse(formatJson({ level: 'info', message: 'hi', name: 'API', timestamp: false }));
  assert.equal(parsed.name, 'API');
});

test('formatJson namespaces metadata keys that collide with reserved fields', () => {
  const parsed = JSON.parse(
    formatJson({ level: 'info', message: 'hi', meta: { level: 'not-a-real-level' }, timestamp: false })
  );
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.meta_level, 'not-a-real-level');
});

test('formatJson serializes an Error passed as metadata under "error"', () => {
  const parsed = JSON.parse(
    formatJson({ level: 'error', message: 'failed', meta: new Error('db down'), timestamp: false })
  );
  assert.equal(parsed.error.name, 'Error');
  assert.equal(parsed.error.message, 'db down');
  assert.equal(typeof parsed.error.stack, 'string');
});

test('formatJson never throws on circular metadata', () => {
  const circular = { name: 'obj' };
  circular.self = circular;
  assert.doesNotThrow(() => {
    const parsed = JSON.parse(formatJson({ level: 'info', message: 'x', meta: circular, timestamp: false }));
    assert.equal(parsed.meta_name, 'obj');
    assert.equal(parsed.self.self, '[Circular]');
  });
});

test('safeStringify handles BigInt values', () => {
  const result = safeStringify({ big: 10n });
  assert.equal(JSON.parse(result).big, '10');
});

test('safeStringify falls back gracefully if something still goes wrong', () => {
  const poison = {};
  Object.defineProperty(poison, 'boom', {
    enumerable: true,
    get() {
      throw new Error('nope');
    },
  });
  const result = safeStringify({ level: 'error', poison });
  assert.doesNotThrow(() => JSON.parse(result));
});
