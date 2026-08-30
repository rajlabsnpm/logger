'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/index.js');
const { Redactor, DEFAULT_REDACT_KEYS } = require('../src/redact');

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

test('redact: [keys] replaces matching keys with [REDACTED] in pretty mode', () => {
  const { log, stdout } = createTestLogger({ redact: ['password', 'token'] });
  log.info('User login', { username: 'raj', password: 'super-secret', token: 'abc123' });
  assert.match(stdout.lines[0], /username=raj/);
  assert.match(stdout.lines[0], /password=\[REDACTED\]/);
  assert.match(stdout.lines[0], /token=\[REDACTED\]/);
});

test('redact works the same way in JSON mode', () => {
  const { log, stdout } = createTestLogger({ redact: ['password', 'token'], format: 'json' });
  log.info('User login', { username: 'raj', password: 'super-secret', token: 'abc123' });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.username, 'raj');
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.token, '[REDACTED]');
});

test('redaction is recursive through nested objects', () => {
  const { log, stdout } = createTestLogger({ redact: ['password'], format: 'json' });
  log.info('nested', { user: { profile: { password: 'secret' } } });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.user.profile.password, '[REDACTED]');
});

test('redaction is recursive through arrays', () => {
  const { log, stdout } = createTestLogger({ redact: ['token'], format: 'json' });
  log.info('list', { sessions: [{ token: 'a' }, { token: 'b' }] });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.sessions[0].token, '[REDACTED]');
  assert.equal(parsed.sessions[1].token, '[REDACTED]');
});

test('path-based redaction only matches the exact path', () => {
  const { log, stdout } = createTestLogger({ redact: ['user.password'], format: 'json' });
  log.info('x', { user: { password: 'secret' }, other: { password: 'still-here' } });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.user.password, '[REDACTED]');
  assert.equal(parsed.other.password, 'still-here');
});

test('wildcard path segments match any key at that depth', () => {
  const { log, stdout } = createTestLogger({ redact: ['*.password'], format: 'json' });
  log.info('x', { admin: { password: 'a' }, guest: { password: 'b' } });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.admin.password, '[REDACTED]');
  assert.equal(parsed.guest.password, '[REDACTED]');
});

test('a bare key name matches at any depth, unlike a dotted path', () => {
  const { log, stdout } = createTestLogger({ redact: ['secret'], format: 'json' });
  log.info('x', { a: { b: { secret: 'deep' } } });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.a.b.secret, '[REDACTED]');
});

test('custom replacement text can be configured', () => {
  const { log, stdout } = createTestLogger({
    redact: { paths: ['password', 'token'], replacement: '[HIDDEN]' },
  });
  log.info('x', { password: 'y' });
  assert.match(stdout.lines[0], /password=\[HIDDEN\]/);
});

test('redact: true enables the built-in sensitive-key defaults', () => {
  const { log, stdout } = createTestLogger({ redact: true, format: 'json' });
  log.info('x', { apiKey: 'k', accessToken: 't', harmless: 'v' });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.apiKey, '[REDACTED]');
  assert.equal(parsed.accessToken, '[REDACTED]');
  assert.equal(parsed.harmless, 'v');
});

test('DEFAULT_REDACT_KEYS covers the documented minimum list', () => {
  for (const key of ['password', 'token', 'authorization', 'cookie', 'secret']) {
    assert.ok(DEFAULT_REDACT_KEYS.includes(key));
  }
});

test('redaction never mutates the caller-provided object', () => {
  const { log } = createTestLogger({ redact: ['password'] });
  const data = { password: 'secret' };
  log.info('User', data);
  assert.equal(data.password, 'secret');
});

test('redaction never mutates nested caller-provided objects', () => {
  const { log } = createTestLogger({ redact: ['password'] });
  const inner = { password: 'secret' };
  const data = { user: inner };
  log.info('User', data);
  assert.equal(inner.password, 'secret');
});

test('circular objects survive redaction without crashing', () => {
  const { log, stdout } = createTestLogger({ redact: ['password'], format: 'json' });
  const obj = { password: 'x' };
  obj.self = obj;
  assert.doesNotThrow(() => log.info('x', obj));
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.self, '[Circular]');
});

test('redaction applies to persistent context set via withContext', () => {
  const { log, stdout } = createTestLogger({ redact: ['token'] });
  log.withContext({ token: 'secret' }).info('msg');
  assert.match(stdout.lines[0], /token=\[REDACTED\]/);
});

test('an invalid redact option throws at createLogger time', () => {
  assert.throws(() => createLogger({ redact: 123 }), TypeError);
  assert.throws(() => createLogger({ redact: { paths: 'not-an-array' } }), TypeError);
  assert.throws(() => createLogger({ redact: [''] }), TypeError);
});

// --- Redactor unit tests ---------------------------------------------------

test('Redactor.redact() is a no-op when disabled', () => {
  const r = new Redactor(undefined);
  const data = { password: 'x' };
  assert.equal(r.redact(data), data);
});

test('Redactor treats class instances as opaque leaves, not walkable objects', () => {
  const r = new Redactor(['password']);
  class Wallet {
    constructor() {
      this.password = 'secret';
    }
  }
  const wallet = new Wallet();
  const out = r.redact({ wallet });
  assert.equal(out.wallet, wallet); // untouched, not redacted, not cloned
});

test('Redactor handles a getter that throws by marking the field unreadable', () => {
  const r = new Redactor(['password']);
  const poison = { password: 'x' };
  Object.defineProperty(poison, 'boom', {
    enumerable: true,
    get() {
      throw new Error('nope');
    },
  });
  const out = r.redact(poison);
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.boom, '[unreadable]');
});
