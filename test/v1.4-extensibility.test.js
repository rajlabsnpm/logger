'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, consoleTransport } = require('../src/index.js');

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

// --- structured entries -----------------------------------------------

test('a custom transport receives a structured entry with the documented shape', () => {
  const entries = [];
  const log = createLogger({
    name: 'API',
    transports: [{ log: (entry) => entries.push(entry) }],
  });
  log.withContext({ requestId: 'r1' }).info('hello', { extra: 1 });

  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'hello');
  assert.equal(entry.name, 'API');
  assert.ok(entry.timestamp instanceof Date);
  assert.deepEqual(entry.context, { requestId: 'r1' });
  assert.deepEqual(entry.metadata, { extra: 1 });
  assert.equal(entry.error, null);
});

test('an Error passed as metadata appears as entry.error, not entry.metadata', () => {
  const entries = [];
  const log = createLogger({ transports: [{ log: (e) => entries.push(e) }] });
  log.error('failed', new Error('boom'));
  assert.equal(entries[0].metadata, null);
  assert.equal(entries[0].error.message, 'boom');
});

// --- transports ----------------------------------------------------------

test('supplying transports replaces the default console transport entirely', () => {
  const stdout = createFakeStream();
  const events = [];
  const log = createLogger({
    stdout,
    transports: [{ log: (e) => events.push(e.message) }],
  });
  log.info('hello');
  assert.equal(stdout.lines.length, 0);
  assert.deepEqual(events, ['hello']);
});

test('consoleTransport() can be combined with a custom transport', () => {
  const stdout = createFakeStream();
  const events = [];
  const log = createLogger({
    stdout,
    transports: [consoleTransport({ stdout, format: 'json' }), { log: (e) => events.push(e.message) }],
  });
  log.info('hello');
  assert.equal(stdout.lines.length, 1);
  assert.deepEqual(events, ['hello']);
});

test('multiple transports all receive every entry', () => {
  const a = [];
  const b = [];
  const log = createLogger({
    transports: [{ log: (e) => a.push(e.message) }, { log: (e) => b.push(e.message) }],
  });
  log.info('x');
  assert.deepEqual(a, ['x']);
  assert.deepEqual(b, ['x']);
});

test('a transport that throws does not crash the app or block other transports', () => {
  const stderr = createFakeStream();
  const originalWrite = process.stderr.write;
  const captured = [];
  process.stderr.write = (chunk) => {
    captured.push(chunk);
    return true;
  };

  const good = [];
  const log = createLogger({
    transports: [{ log: () => { throw new Error('transport is broken'); } }, { log: (e) => good.push(e.message) }],
  });

  try {
    assert.doesNotThrow(() => log.info('still works'));
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.deepEqual(good, ['still works']);
});

test('createLogger({ transports }) validates that every entry has a log() method', () => {
  assert.throws(() => createLogger({ transports: [{}] }), TypeError);
  assert.throws(() => createLogger({ transports: 'nope' }), TypeError);
});

test('logger.flush() and logger.close() call through to transports that implement them', () => {
  let flushed = false;
  let closed = false;
  const log = createLogger({
    transports: [
      {
        log() {},
        flush() {
          flushed = true;
        },
        close() {
          closed = true;
        },
      },
    ],
  });
  log.flush();
  log.close();
  assert.equal(flushed, true);
  assert.equal(closed, true);
});

test('flush()/close() are safe to call when a transport does not implement them', () => {
  const log = createLogger({ transports: [{ log() {} }] });
  assert.doesNotThrow(() => {
    log.flush();
    log.close();
  });
});

// --- hooks ---------------------------------------------------------------

test('hooks.before can mutate the entry before it reaches transports', () => {
  const entries = [];
  const log = createLogger({
    transports: [{ log: (e) => entries.push(e) }],
    hooks: {
      before(entry) {
        entry.message = entry.message.toUpperCase();
        return entry;
      },
    },
  });
  log.info('hello');
  assert.equal(entries[0].message, 'HELLO');
});

test('hooks.before returning false cancels logging entirely', () => {
  const entries = [];
  const log = createLogger({
    transports: [{ log: (e) => entries.push(e) }],
    hooks: { before: () => false },
  });
  log.info('hello');
  assert.equal(entries.length, 0);
});

test('hooks.after runs once the entry has been sent to transports', () => {
  const order = [];
  const log = createLogger({
    transports: [{ log: () => order.push('transport') }],
    hooks: { after: () => order.push('after') },
  });
  log.info('hello');
  assert.deepEqual(order, ['transport', 'after']);
});

test('a throwing before-hook does not crash the app and logging still proceeds', () => {
  const originalWrite = process.stderr.write;
  process.stderr.write = () => true;
  const entries = [];
  const log = createLogger({
    transports: [{ log: (e) => entries.push(e) }],
    hooks: { before: () => { throw new Error('bad hook'); } },
  });
  try {
    assert.doesNotThrow(() => log.info('hello'));
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'hello');
});

test('a throwing after-hook does not crash the app', () => {
  const originalWrite = process.stderr.write;
  process.stderr.write = () => true;
  const log = createLogger({
    transports: [{ log() {} }],
    hooks: { after: () => { throw new Error('bad hook'); } },
  });
  try {
    assert.doesNotThrow(() => log.info('hello'));
  } finally {
    process.stderr.write = originalWrite;
  }
});

test('createLogger({ hooks }) validates before/after are functions', () => {
  assert.throws(() => createLogger({ hooks: { before: 'nope' } }), TypeError);
  assert.throws(() => createLogger({ hooks: { after: 123 } }), TypeError);
  assert.throws(() => createLogger({ hooks: 'nope' }), TypeError);
});

test('consoleTransport() works standalone with default level metadata (no logger involved)', () => {
  const stdout = createFakeStream();
  const transport = consoleTransport({ stdout, format: 'pretty' });
  assert.doesNotThrow(() => {
    transport.log({
      timestamp: null,
      level: 'info',
      message: 'standalone',
      name: '',
      context: null,
      metadata: null,
      error: null,
      source: null,
    });
  });
  assert.match(stdout.lines[0], /INFO/);
});

// --- custom levels -----------------------------------------------------

test('a custom level becomes a callable method that respects level filtering', () => {
  const stdout = createFakeStream();
  const log = createLogger({
    stdout,
    level: 'trace',
    levels: { trace: 5, debug: 10, info: 20, success: 25, warn: 30, error: 40, fatal: 50 },
  });
  log.trace('detailed trace');
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /TRACE/);
});

test('a custom level is filtered out when below the configured minimum level', () => {
  const stdout = createFakeStream();
  const log = createLogger({
    stdout,
    level: 'debug',
    levels: { trace: 5, debug: 10, info: 20, success: 25, warn: 30, error: 40, fatal: 50 },
  });
  log.trace('hidden');
  assert.equal(stdout.lines.length, 0);
});

test('createLogger({ levels }) rejects a name that collides with a reserved method', () => {
  assert.throws(() => createLogger({ levels: { child: 5 } }), TypeError);
});
