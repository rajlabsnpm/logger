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

// warn/error/fatal route to stderr by default; info/debug/trace route to stdout.
function createTestLogger(options = {}) {
  const stdout = createFakeStream();
  const stderr = createFakeStream();
  const log = createLogger({ ...options, stdout, stderr, timestamp: false, colors: false });
  return { log, stdout, stderr };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- off by default: zero behavior change ---

test('collapsing is disabled by default: repeated calls are all logged individually', () => {
  const { log, stderr } = createTestLogger({ format: 'json' });
  for (let i = 0; i < 5; i++) log.warn('Retry failed');
  assert.equal(stderr.lines.length, 5);
  assert.equal(log._core.collapser.enabled, false);
});

// --- basic collapsing behavior ---

test('the first occurrence is always logged immediately and in full', () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 50 } });
  log.warn('Retry failed', { attempt: 1 });
  assert.equal(stderr.lines.length, 1);
  const parsed = JSON.parse(stderr.lines[0]);
  assert.equal(parsed.message, 'Retry failed');
  assert.equal(parsed.attempt, 1);
  assert.equal(parsed.collapsed, undefined);
});

test('duplicates within the window are suppressed until the window closes', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 50 } });
  for (let i = 0; i < 10; i++) log.warn('Retry failed');
  assert.equal(stderr.lines.length, 1, 'only the first occurrence should be visible so far');
  await wait(80);
  assert.equal(stderr.lines.length, 2, 'exactly one summary line should appear after the window closes');
  const summary = JSON.parse(stderr.lines[1]);
  assert.equal(summary.message, 'Retry failed');
  assert.deepEqual(summary.collapsed, { count: 9, windowMs: 50 });
});

test('a message that never repeats produces no summary line at all', async () => {
  const { log, stdout } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  log.info('this happens exactly once');
  await wait(60);
  assert.equal(stdout.lines.length, 1);
});

test('the summary preserves the exact original message text (machine-readable grouping)', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  for (let i = 0; i < 3; i++) log.warn('disk usage high');
  await wait(60);
  const summary = JSON.parse(stderr.lines[1]);
  assert.equal(summary.message, 'disk usage high');
});

test('the summary carries the metadata from the most recent suppressed occurrence', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  for (let i = 1; i <= 4; i++) log.warn('Retry failed', { attempt: i });
  await wait(60);
  assert.equal(JSON.parse(stderr.lines[0]).attempt, 1);
  const summary = JSON.parse(stderr.lines[1]);
  assert.equal(summary.attempt, 4);
  assert.equal(summary.collapsed.count, 3);
});

// --- what counts as a duplicate ---

test('different levels with the same message text do not collapse together', () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 50 } });
  log.warn('disk usage high');
  log.error('disk usage high'); // both route to stderr, but level is part of the key -> distinct
  assert.equal(stderr.lines.length, 2);
});

test('different logger names (via child loggers) do not collapse together', () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 50 } });
  const payments = log.child('payments');
  const checkout = log.child('checkout');
  payments.warn('rate limited');
  checkout.warn('rate limited');
  assert.equal(stderr.lines.length, 2);
});

test('errors with different messages do not collapse even when the log message matches', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  log.error('upstream call failed', new Error('timeout'));
  log.error('upstream call failed', new Error('connection reset'));
  await wait(60);
  // two distinct keys, neither repeated -> two lines, no summaries
  assert.equal(stderr.lines.length, 2);
});

test('errors with the same name+message do collapse, and the summary keeps full error detail', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  for (let i = 0; i < 3; i++) log.error('upstream call failed', new Error('timeout'));
  await wait(60);
  assert.equal(stderr.lines.length, 2);
  const first = JSON.parse(stderr.lines[0]);
  const summary = JSON.parse(stderr.lines[1]);
  assert.equal(first.error.message, 'timeout');
  assert.equal(summary.error.message, 'timeout');
  assert.equal(summary.collapsed.count, 2);
});

// --- bounded memory ---

test('maxTracked caps simultaneous distinct keys without dropping any messages', () => {
  const { log, stderr } = createTestLogger({
    format: 'json',
    collapse: { windowMs: 60000, maxTracked: 3 },
  });
  for (let i = 0; i < 10; i++) log.warn(`distinct message ${i}`);
  assert.equal(log._core.collapser.states.size, 3);
  // every message still gets logged at least once, even past the cap
  assert.equal(stderr.lines.length, 10);
});

// --- flush/close ---

test('flush() emits pending summaries immediately instead of waiting for the window', () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 60000 } });
  for (let i = 0; i < 4; i++) log.warn('flood');
  assert.equal(stderr.lines.length, 1);
  log.flush();
  assert.equal(stderr.lines.length, 2);
  assert.equal(JSON.parse(stderr.lines[1]).collapsed.count, 3);
});

test('close() also flushes pending summaries', () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 60000 } });
  for (let i = 0; i < 4; i++) log.warn('flood');
  log.close();
  assert.equal(stderr.lines.length, 2);
});

test('a continuing flood produces a fresh first-occurrence + summary cycle after each window', async () => {
  const { log, stderr } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  for (let i = 0; i < 5; i++) log.warn('flood');
  await wait(60);
  for (let i = 0; i < 5; i++) log.warn('flood');
  await wait(60);
  // cycle 1: first + summary, cycle 2: first + summary
  assert.equal(stderr.lines.length, 4);
  assert.equal(JSON.parse(stderr.lines[1]).collapsed.count, 4);
  assert.equal(JSON.parse(stderr.lines[3]).collapsed.count, 4);
});

// --- pipeline integration ---

test('hooks and transports only see the first occurrence and the summary, not every suppressed call', async () => {
  const seen = [];
  const { log, stderr } = createTestLogger({
    format: 'json',
    collapse: { windowMs: 30 },
    hooks: { before: (entry) => (seen.push(entry.message), entry) },
  });
  for (let i = 0; i < 20; i++) log.warn('Retry failed');
  await wait(60);
  assert.equal(seen.length, 2);
  assert.equal(stderr.lines.length, 2);
});

test('redaction still applies normally to a collapsed summary entry', async () => {
  const { log, stderr } = createTestLogger({
    format: 'json',
    collapse: { windowMs: 30 },
    redact: ['token'],
  });
  for (let i = 0; i < 3; i++) log.warn('auth retry', { token: 'secret-value' });
  await wait(60);
  const summary = JSON.parse(stderr.lines[1]);
  assert.equal(summary.token, '[REDACTED]');
});

// --- rendering ---

test('pretty mode renders a "(+N more in Xs)" suffix on the summary line only', async () => {
  const { log, stderr } = createTestLogger({ collapse: { windowMs: 30 } });
  for (let i = 0; i < 4; i++) log.warn('Retry failed');
  await wait(60);
  assert.doesNotMatch(stderr.lines[0], /more in/);
  assert.match(stderr.lines[1], /Retry failed\s+\(\+3 more in 0\.0s\)/);
});

// --- config validation ---

test('collapse: true uses sane defaults and does not throw', () => {
  assert.doesNotThrow(() => createLogger({ collapse: true }));
});

test('collapse: { windowMs } must be a positive number', () => {
  assert.throws(() => createLogger({ collapse: { windowMs: -1 } }), TypeError);
  assert.throws(() => createLogger({ collapse: { windowMs: 0 } }), TypeError);
  assert.throws(() => createLogger({ collapse: { windowMs: 'soon' } }), TypeError);
});

test('collapse: { maxTracked } must be a positive integer', () => {
  assert.throws(() => createLogger({ collapse: { maxTracked: 0 } }), TypeError);
  assert.throws(() => createLogger({ collapse: { maxTracked: 1.5 } }), TypeError);
});

test('collapse must be `true` or an object, otherwise it throws', () => {
  assert.throws(() => createLogger({ collapse: 'yes' }), TypeError);
});

test('a hostile toString() on the message does not crash collapse tracking', () => {
  const { log } = createTestLogger({ format: 'json', collapse: { windowMs: 30 } });
  const hostileMessage = {
    toString() {
      throw new Error('nope');
    },
  };
  assert.doesNotThrow(() => log.warn(hostileMessage));
});
