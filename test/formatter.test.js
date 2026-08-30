'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatPretty,
  formatJson,
  safeStringify,
  formatMetaPretty,
  formatMetaValue,
  flattenFields,
} = require('../src/formatter');
const { LEVELS, LEVEL_ORDER } = require('../src/levels');

const LABEL_WIDTH = Math.max(...LEVEL_ORDER.map((n) => LEVELS[n].label.length));

function entry(overrides = {}) {
  return Object.assign(
    {
      timestamp: null,
      level: 'info',
      message: '',
      name: undefined,
      context: null,
      metadata: null,
      error: null,
      source: null,
    },
    overrides
  );
}

test('formatPretty includes a HH:MM:SS timestamp when a Date is given', () => {
  const line = formatPretty(entry({ timestamp: new Date(), message: 'hello' }), false, LEVELS, LABEL_WIDTH);
  assert.match(line, /^\d{2}:\d{2}:\d{2}\s\s/);
});

test('formatPretty omits the timestamp when null', () => {
  const line = formatPretty(entry({ message: 'hello' }), false, LEVELS, LABEL_WIDTH);
  assert.doesNotMatch(line, /^\d{2}:\d{2}:\d{2}/);
  assert.match(line, /^INFO/);
});

test('formatPretty right-pads level labels so they line up', () => {
  const info = formatPretty(entry({ level: 'info', message: 'x' }), false, LEVELS, LABEL_WIDTH);
  const success = formatPretty(entry({ level: 'success', message: 'x' }), false, LEVELS, LABEL_WIDTH);
  assert.equal(info.indexOf('x'), success.indexOf('x'));
});

test('formatPretty shows the namespace when a name is set', () => {
  const line = formatPretty(entry({ name: 'API', message: 'started' }), false, LEVELS, LABEL_WIDTH);
  assert.match(line, /\[API\]/);
  assert.match(line, /started/);
});

test('formatPretty renders flattened context+metadata as key=value pairs', () => {
  const line = formatPretty(
    entry({ message: 'Server started', metadata: { port: 3000 }, context: { env: 'production' } }),
    false,
    LEVELS,
    LABEL_WIDTH
  );
  assert.match(line, /port=3000/);
  assert.match(line, /env=production/);
});

test('formatPretty lets explicit metadata win over context on key collisions', () => {
  const fields = flattenFields(entry({ context: { userId: 1 }, metadata: { userId: 2 } }));
  assert.equal(fields.userId, 2);
});

test('formatPretty renders a numeric "duration" field with an ms suffix', () => {
  const line = formatPretty(entry({ message: 'done', metadata: { duration: 143 } }), false, LEVELS, LABEL_WIDTH);
  assert.match(line, /duration=143ms/);
});

test('formatPretty renders a serialized error with stack and cause chain', () => {
  const line = formatPretty(
    entry({
      level: 'error',
      message: 'failed',
      error: {
        name: 'Error',
        message: 'query failed',
        stack: 'Error: query failed\n    at x',
        cause: { name: 'Error', message: 'conn refused', stack: 'Error: conn refused\n    at y' },
      },
    }),
    false,
    LEVELS,
    LABEL_WIDTH
  );
  assert.match(line, /failed/);
  assert.match(line, /Error: query failed/);
  assert.match(line, /Caused by:/);
  assert.match(line, /Error: conn refused/);
});

test('formatPretty renders a source location tag when present', () => {
  const line = formatPretty(entry({ message: 'x', source: 'src/server.js:42' }), false, LEVELS, LABEL_WIDTH);
  assert.match(line, /\[src\/server\.js:42\]/);
});

test('formatPretty never throws on circular metadata', () => {
  const circular = { name: 'obj' };
  circular.self = circular;
  assert.doesNotThrow(() => {
    formatPretty(entry({ message: 'circular test', metadata: circular }), false, LEVELS, LABEL_WIDTH);
  });
});

test('formatPretty handles empty and undefined messages without throwing', () => {
  assert.doesNotThrow(() => formatPretty(entry({ message: '' }), false, LEVELS, LABEL_WIDTH));
  assert.doesNotThrow(() => formatPretty(entry({ message: undefined }), false, LEVELS, LABEL_WIDTH));
  assert.doesNotThrow(() => formatPretty(entry({ message: null }), false, LEVELS, LABEL_WIDTH));
});

test('formatPretty degrades a single hostile-getter field instead of losing the whole line', () => {
  const poison = {};
  Object.defineProperty(poison, 'boom', {
    enumerable: true,
    get() {
      throw new Error('nope');
    },
  });
  const line = formatPretty(entry({ message: 'x', metadata: poison }), false, LEVELS, LABEL_WIDTH);
  assert.match(line, /boom=\[unreadable\]/);
});

test('formatMetaValue formats primitives, strings with spaces, and objects', () => {
  assert.equal(formatMetaValue('n', 42), '42');
  assert.equal(formatMetaValue('n', true), 'true');
  assert.equal(formatMetaValue('n', null), 'null');
  assert.equal(formatMetaValue('n', undefined), 'undefined');
  assert.equal(formatMetaValue('n', 'nospaces'), 'nospaces');
  assert.equal(formatMetaValue('n', 'has spaces'), '"has spaces"');
  assert.match(formatMetaValue('n', [1, 2, 3]), /1, 2, 3/);
});

test('formatMetaValue special-cases "duration" as milliseconds', () => {
  assert.equal(formatMetaValue('duration', 42), '42ms');
  assert.equal(formatMetaValue('other', 42), '42');
});

test('formatMetaPretty joins multiple keys with spaces', () => {
  const result = formatMetaPretty({ a: 1, b: 'two' });
  assert.equal(result, 'a=1 b=two');
});

test('flattenFields returns null when there is nothing to flatten', () => {
  assert.equal(flattenFields(entry()), null);
});

test('formatJson produces valid, parseable JSON with the documented shape', () => {
  const line = formatJson(entry({ message: 'Server started', metadata: { port: 3000 }, timestamp: new Date() }));
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'Server started');
  assert.equal(parsed.port, 3000);
  assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('formatJson omits the timestamp field when null', () => {
  const parsed = JSON.parse(formatJson(entry({ message: 'hi' })));
  assert.equal('timestamp' in parsed, false);
});

test('formatJson includes the namespace when present', () => {
  const parsed = JSON.parse(formatJson(entry({ message: 'hi', name: 'API' })));
  assert.equal(parsed.name, 'API');
});

test('formatJson namespaces metadata keys that collide with reserved fields', () => {
  const parsed = JSON.parse(formatJson(entry({ message: 'hi', metadata: { level: 'not-a-real-level' } })));
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.meta_level, 'not-a-real-level');
});

test('formatJson includes a serialized error under "error"', () => {
  const parsed = JSON.parse(
    formatJson(entry({ level: 'error', message: 'failed', error: { name: 'Error', message: 'db down', stack: 'Error: db down\n at x' } }))
  );
  assert.equal(parsed.error.name, 'Error');
  assert.equal(parsed.error.message, 'db down');
  assert.equal(typeof parsed.error.stack, 'string');
});

test('formatJson includes source when present', () => {
  const parsed = JSON.parse(formatJson(entry({ message: 'x', source: 'src/a.js:1' })));
  assert.equal(parsed.source, 'src/a.js:1');
});

test('formatJson never throws on circular metadata', () => {
  const circular = { name: 'obj' };
  circular.self = circular;
  assert.doesNotThrow(() => {
    const parsed = JSON.parse(formatJson(entry({ message: 'x', metadata: circular })));
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
