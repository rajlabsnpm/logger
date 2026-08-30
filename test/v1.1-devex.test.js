'use strict';

const test = require('node:test');
const { beforeEach, afterEach } = test;
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');

let savedEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

function createFakeStream(isTTY = false) {
  const chunks = [];
  return {
    isTTY,
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
  const stdout = createFakeStream(options.tty);
  const stderr = createFakeStream(options.tty);
  const log = createLogger({ ...options, stdout, stderr });
  return { log, stdout, stderr };
}

// --- fatal ---------------------------------------------------------------

test('fatal() is available and writes to stderr', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  log.fatal('Application cannot continue');
  assert.equal(stderr.lines.length, 1);
  assert.match(stderr.lines[0], /FATAL/);
});

test('level: "error" allows error and fatal but suppresses everything below', () => {
  const { log, stdout, stderr } = createTestLogger({ level: 'error', timestamp: false });
  log.debug('x');
  log.info('x');
  log.success('x');
  log.warn('x');
  log.error('shows');
  log.fatal('shows too');
  assert.equal(stdout.lines.length, 0);
  assert.equal(stderr.lines.length, 2);
});

// --- timers ----------------------------------------------------------------

test('log.time(label).end() logs a completion message with a duration', async () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const timer = log.time('Database query');
  await new Promise((resolve) => setTimeout(resolve, 5));
  timer.end();
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /Database query completed/);
  assert.match(stdout.lines[0], /duration=\d+(\.\d+)?ms/);
});

test('timer.end(message, meta) uses the custom message and merges extra metadata', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const timer = log.time('Query');
  timer.end('Query finished', { rows: 5 });
  assert.match(stdout.lines[0], /Query finished/);
  assert.match(stdout.lines[0], /rows=5/);
});

test('calling timer.end() twice does not crash and only logs once', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const timer = log.time('Query');
  assert.doesNotThrow(() => {
    timer.end();
    timer.end();
    timer.end();
  });
  assert.equal(stdout.lines.length, 1);
});

test('log.time()/log.timeEnd() console.time-style pairing works', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  log.time('op');
  log.timeEnd('op', 'op finished');
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /op finished/);
});

test('log.timeEnd() on an unknown label is a silent no-op', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  assert.doesNotThrow(() => log.timeEnd('never-started'));
  assert.equal(stdout.lines.length, 0);
});

test('timers work across a child logger and still carry its name/context', () => {
  const { log, stdout } = createTestLogger({ name: 'API', timestamp: false });
  const child = log.child('DB');
  const timer = child.time('Query');
  timer.end();
  assert.match(stdout.lines[0], /\[API:DB\]/);
});

// --- withContext -------------------------------------------------------

test('withContext attaches fields to every subsequent message', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const reqLog = log.withContext({ requestId: 'req_123', userId: 42 });
  reqLog.info('Fetching user');
  reqLog.info('User found');
  assert.match(stdout.lines[0], /requestId=req_123 userId=42/);
  assert.match(stdout.lines[1], /requestId=req_123 userId=42/);
});

test('explicit metadata overrides withContext on a key collision', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  log.withContext({ userId: 1 }).info('Test', { userId: 2 });
  assert.match(stdout.lines[0], /userId=2/);
  assert.doesNotMatch(stdout.lines[0], /userId=1/);
});

test('withContext composes with child()', () => {
  const { log, stdout } = createTestLogger({ name: 'API', timestamp: false });
  const scoped = log.withContext({ requestId: 'r1' }).child('DB');
  scoped.info('query');
  assert.match(stdout.lines[0], /\[API:DB\]/);
  assert.match(stdout.lines[0], /requestId=r1/);
});

test('withContext calls stack: later context wins over earlier context', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const scoped = log.withContext({ a: 1 }).withContext({ a: 2, b: 3 });
  scoped.info('msg');
  assert.match(stdout.lines[0], /a=2/);
  assert.match(stdout.lines[0], /b=3/);
});

test('withContext requires a plain object', () => {
  const { log } = createTestLogger();
  assert.throws(() => log.withContext('nope'), TypeError);
  assert.throws(() => log.withContext(null), TypeError);
});

// --- once ----------------------------------------------------------------

test('once() only logs the first call for a given key', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  log.once('db-fallback', 'Database is running in fallback mode');
  log.once('db-fallback', 'Database is running in fallback mode');
  log.once('db-fallback', 'Database is running in fallback mode');
  assert.equal(stderr.lines.length, 1);
});

test('once() with different keys logs each key once', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  log.once('a', 'first');
  log.once('b', 'second');
  assert.equal(stderr.lines.length, 2);
});

test('once() state is shared across child loggers derived from the same root', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  const child = log.child('X');
  log.once('shared', 'first');
  child.once('shared', 'first');
  assert.equal(stderr.lines.length, 1);
});

test('resetOnce(key) allows a specific key to fire again', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  log.once('k', 'msg');
  log.resetOnce('k');
  log.once('k', 'msg');
  assert.equal(stderr.lines.length, 2);
});

test('resetOnce() with no key clears all keys', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  log.once('a', 'msg');
  log.once('b', 'msg');
  log.resetOnce();
  log.once('a', 'msg');
  log.once('b', 'msg');
  assert.equal(stderr.lines.length, 4);
});

test('once() requires a non-empty string key', () => {
  const { log } = createTestLogger();
  assert.throws(() => log.once('', 'msg'), TypeError);
  assert.throws(() => log.once(42, 'msg'), TypeError);
});

// --- auto config -----------------------------------------------------------

test('level: "auto" resolves to "debug" outside production/CI', () => {
  delete process.env.NODE_ENV;
  delete process.env.CI;
  const log = createLogger({ level: 'auto' });
  assert.equal(log.level, 'debug');
});

test('level: "auto" resolves to "info" when NODE_ENV=production', () => {
  process.env.NODE_ENV = 'production';
  const log = createLogger({ level: 'auto' });
  assert.equal(log.level, 'info');
});

test('level: "auto" resolves to "info" when CI is set', () => {
  delete process.env.NODE_ENV;
  process.env.CI = 'true';
  const log = createLogger({ level: 'auto' });
  assert.equal(log.level, 'info');
});

test('format: "auto" resolves to "json" when NODE_ENV=production', () => {
  process.env.NODE_ENV = 'production';
  const log = createLogger({ format: 'auto' });
  assert.equal(log.format, 'json');
});
