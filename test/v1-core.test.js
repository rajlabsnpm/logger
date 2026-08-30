'use strict';

const test = require('node:test');
const { beforeEach, afterEach } = test;
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');
const { Logger } = require('../src/logger');

let savedForceColor;
let savedNoColor;

beforeEach(() => {
  savedForceColor = process.env.FORCE_COLOR;
  savedNoColor = process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
});

afterEach(() => {
  if (savedForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = savedForceColor;

  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
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

test('createLogger returns a Logger instance', () => {
  const log = createLogger();
  assert.ok(log instanceof Logger);
});

test('every documented level method exists and is callable', () => {
  const { log, stdout, stderr } = createTestLogger();
  log.debug('a');
  log.info('b');
  log.success('c');
  log.warn('d');
  log.error('e');
  assert.equal(stdout.lines.length, 3);
  assert.equal(stderr.lines.length, 2);
});

test('debug/info/success go to stdout, warn/error go to stderr', () => {
  const { log, stdout, stderr } = createTestLogger();
  log.info('to stdout');
  log.error('to stderr');
  assert.equal(stdout.lines.length, 1);
  assert.equal(stderr.lines.length, 1);
  assert.match(stdout.lines[0], /to stdout/);
  assert.match(stderr.lines[0], /to stderr/);
});

test('default level is debug, so nothing is filtered out of the box', () => {
  const { log, stdout } = createTestLogger();
  log.debug('shows up');
  assert.equal(stdout.lines.length, 1);
});

test('setting level to info filters out debug messages', () => {
  const { log, stdout } = createTestLogger({ level: 'info' });
  log.debug('hidden');
  log.info('visible');
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /visible/);
});

test('setting level to error filters out everything below error', () => {
  const { log, stdout, stderr } = createTestLogger({ level: 'error' });
  log.debug('x');
  log.info('x');
  log.success('x');
  log.warn('x');
  log.error('shows up');
  assert.equal(stdout.lines.length, 0);
  assert.equal(stderr.lines.length, 1);
});

test('an invalid level falls back to the default instead of throwing', () => {
  assert.doesNotThrow(() => createTestLogger({ level: 'not-a-level' }));
  const { log, stdout } = createTestLogger({ level: 'not-a-level' });
  log.debug('still shows because of fallback to debug default');
  assert.equal(stdout.lines.length, 1);
});

test('timestamps are included by default', () => {
  const { log, stdout } = createTestLogger();
  log.info('hi');
  assert.match(stdout.lines[0], /^\d{2}:\d{2}:\d{2}/);
});

test('timestamps can be disabled', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  log.info('hi');
  assert.doesNotMatch(stdout.lines[0], /^\d{2}:\d{2}:\d{2}/);
});

test('a configured name appears in the output', () => {
  const { log, stdout } = createTestLogger({ name: 'API', timestamp: false });
  log.info('ready');
  assert.match(stdout.lines[0], /\[API\]/);
});

test('child() extends the namespace with a colon separator', () => {
  const { log, stdout } = createTestLogger({ name: 'API', timestamp: false });
  const dbLog = log.child('Database');
  dbLog.info('connected');
  assert.match(stdout.lines[0], /\[API:Database\]/);
});

test('child() inherits level, format and timestamp settings', () => {
  const { log, stdout } = createTestLogger({ level: 'warn', timestamp: false });
  const child = log.child('Sub');
  child.info('hidden by inherited level');
  child.warn('visible');
  assert.equal(stdout.lines.length, 0);
});

test('child() rejects an empty or non-string name', () => {
  const { log } = createTestLogger();
  assert.throws(() => log.child(''), TypeError);
  assert.throws(() => log.child('   '), TypeError);
  assert.throws(() => log.child(42), TypeError);
});

test('metadata objects are logged without crashing and appear in output', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  log.info('User created', { id: 123, name: 'Raj', active: true });
  assert.match(stdout.lines[0], /id=123/);
  assert.match(stdout.lines[0], /name=Raj/);
  assert.match(stdout.lines[0], /active=true/);
});

test('nested objects and arrays in metadata do not crash the logger', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  assert.doesNotThrow(() => {
    log.info('nested', {
      user: { id: 1, roles: ['admin', 'user'] },
      tags: [1, 2, { deep: true }],
    });
  });
  assert.equal(stdout.lines.length, 1);
});

test('Error objects passed as the second argument are handled properly', () => {
  const { log, stderr } = createTestLogger({ timestamp: false });
  const error = new Error('Database connection failed');
  log.error('Database connection failed', error);
  const output = stderr.lines.join('\n');
  assert.match(output, /Database connection failed/);
  assert.match(output, /Error: Database connection failed/);
});

test('circular objects never crash the logger in pretty mode', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  const circular = { name: 'circular-test' };
  circular.self = circular;
  assert.doesNotThrow(() => log.info('circular', circular));
  assert.equal(stdout.lines.length, 1);
});

test('circular objects never crash the logger in JSON mode', () => {
  const { log, stdout } = createTestLogger({ format: 'json', timestamp: false });
  const circular = { name: 'circular-test' };
  circular.self = circular;
  assert.doesNotThrow(() => log.info('circular', circular));
  assert.doesNotThrow(() => JSON.parse(stdout.lines[0]));
});

test('colors are applied when the stream is a TTY and colors are not disabled', () => {
  const { log, stdout } = createTestLogger({ tty: true, timestamp: false });
  log.info('colorful');
  assert.match(stdout.lines[0], /\x1b\[/);
});

test('colors are omitted when the stream is not a TTY', () => {
  const { log, stdout } = createTestLogger({ tty: false, timestamp: false });
  log.info('plain');
  assert.doesNotMatch(stdout.lines[0], /\x1b\[/);
});

test('colors can be force-disabled even on a TTY', () => {
  const { log, stdout } = createTestLogger({ tty: true, colors: false, timestamp: false });
  log.info('plain please');
  assert.doesNotMatch(stdout.lines[0], /\x1b\[/);
});

test('colors can be force-enabled even off a TTY', () => {
  const { log, stdout } = createTestLogger({ tty: false, colors: true, timestamp: false });
  log.info('force colorful');
  assert.match(stdout.lines[0], /\x1b\[/);
});

test('FORCE_COLOR env var forces colors on even when not a TTY', () => {
  process.env.FORCE_COLOR = '1';
  const { log, stdout } = createTestLogger({ tty: false, timestamp: false });
  log.info('forced by env var');
  assert.match(stdout.lines[0], /\x1b\[/);
});

test('NO_COLOR env var disables colors even on a TTY', () => {
  process.env.NO_COLOR = '1';
  const { log, stdout } = createTestLogger({ tty: true, timestamp: false });
  log.info('disabled by env var');
  assert.doesNotMatch(stdout.lines[0], /\x1b\[/);
});

test('an explicit colors:false option wins over FORCE_COLOR', () => {
  process.env.FORCE_COLOR = '1';
  const { log, stdout } = createTestLogger({ tty: false, colors: false, timestamp: false });
  log.info('explicit still wins');
  assert.doesNotMatch(stdout.lines[0], /\x1b\[/);
});

test('JSON mode produces one valid JSON object per line with the documented fields', () => {
  const { log, stdout } = createTestLogger({ format: 'json', timestamp: true });
  log.info('Server started', { port: 3000 });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'Server started');
  assert.equal(parsed.port, 3000);
  assert.ok(parsed.timestamp);
});

test('an invalid format string falls back to pretty output instead of throwing', () => {
  const { log, stdout } = createTestLogger({ format: 'yaml', timestamp: false });
  assert.doesNotThrow(() => log.info('fallback'));
  assert.match(stdout.lines[0], /INFO/);
});

test('empty string messages do not crash the logger', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  assert.doesNotThrow(() => log.info(''));
  assert.equal(stdout.lines.length, 1);
});

test('undefined and null messages do not crash the logger', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  assert.doesNotThrow(() => log.info(undefined));
  assert.doesNotThrow(() => log.info(null));
  assert.equal(stdout.lines.length, 2);
});

test('unusual metadata values (functions, symbols, NaN) do not crash the logger', () => {
  const { log, stdout } = createTestLogger({ timestamp: false });
  assert.doesNotThrow(() => {
    log.info('weird', { fn: () => {}, sym: Symbol('x'), nan: NaN, big: 10n });
  });
  assert.equal(stdout.lines.length, 1);
});

test('createLogger() with no arguments at all works out of the box', () => {
  const stdout = createFakeStream(false);
  const stderr = createFakeStream(false);
  assert.doesNotThrow(() => {
    const log = createLogger({ stdout, stderr });
    log.debug('d');
    log.info('i');
    log.success('s');
    log.warn('w');
    log.error('e');
  });
  assert.equal(stdout.lines.length, 3);
  assert.equal(stderr.lines.length, 2);
});