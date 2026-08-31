'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { createLogger } = require('../src/index.js');
const { Redactor, MAX_REDACT_DEPTH, DEPTH_LIMIT_MARKER } = require('../src/redact');

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

test('timer.end() removes its own entry from the internal registry (no leak)', () => {
  const { log } = createTestLogger();
  for (let i = 0; i < 1000; i++) {
    const timer = log.time(`op-${i}`);
    timer.end();
  }
  assert.equal(log._core.timers.size, 0);
});

test('repeated timer.end() calls remain a safe no-op and do not double-log', () => {
  const { log, stdout } = createTestLogger();
  const timer = log.time('op');
  timer.end();
  assert.doesNotThrow(() => timer.end());
  assert.doesNotThrow(() => timer.end());
  assert.equal(stdout.lines.length, 1);
  assert.equal(log._core.timers.size, 0);
});

test('multiple concurrent timers under different labels stay isolated', () => {
  const { log } = createTestLogger();
  const a = log.time('a');
  const b = log.time('b');
  b.end();
  assert.equal(log._core.timers.has('a'), true);
  assert.equal(log._core.timers.has('b'), false);
  a.end();
  assert.equal(log._core.timers.has('a'), false);
});

test('ending an older timer after a newer one reused the same label does not delete the newer one', () => {
  const { log } = createTestLogger();
  const first = log.time('op');
  const second = log.time('op'); // overwrites the registry slot for 'op'
  first.end(); // must NOT remove second's still-live entry
  assert.equal(log._core.timers.get('op'), second);
  second.end();
  assert.equal(log._core.timers.has('op'), false);
});

test('an abandoned (never-ended) timer is not swept up by unrelated timer activity', () => {
  const { log } = createTestLogger();
  log.time('abandoned');
  const other = log.time('other');
  other.end();
  assert.equal(log._core.timers.has('abandoned'), true);
});

test('logger.timeEnd(label) still works and cleans up the registry', () => {
  const { log, stdout } = createTestLogger();
  log.time('op');
  log.timeEnd('op');
  assert.equal(log._core.timers.has('op'), false);
  assert.match(stdout.lines[0], /op completed/);
});

test('logger.timeEnd() on an unknown or already-ended label is a safe no-op', () => {
  const { log } = createTestLogger();
  assert.doesNotThrow(() => log.timeEnd('never-started'));
  const timer = log.time('op');
  log.timeEnd('op');
  assert.doesNotThrow(() => log.timeEnd('op'));
  assert.doesNotThrow(() => timer.end());
});

test('async timers across an await boundary remain isolated and clean up correctly', async () => {
  const { log } = createTestLogger();
  const timerA = log.time('async-a');
  await new Promise((resolve) => setImmediate(resolve));
  const timerB = log.time('async-b');
  timerB.end();
  assert.equal(log._core.timers.has('async-a'), true);
  assert.equal(log._core.timers.has('async-b'), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  timerA.end();
  assert.equal(log._core.timers.has('async-a'), false);
});

test('timers share one registry across a child logger', () => {
  const { log } = createTestLogger();
  const child = log.child('worker');
  child.time('job');
  assert.equal(log._core.timers.has('job'), true);
  log.timeEnd('job'); // ended from the parent, started on the child
  assert.equal(log._core.timers.has('job'), false);
});

test('pretty mode: a newline in the message cannot forge an additional log line', () => {
  const { log, stdout } = createTestLogger();
  log.info('line one\nFAKE fatal: system compromised');
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /line one\\nFAKE/);
});

test('pretty mode: CRLF in the message cannot forge an additional log line', () => {
  const { log, stdout } = createTestLogger();
  log.info('line one\r\nFAKE fatal: system compromised');
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /line one\\r\\nFAKE/);
});

test('pretty mode: ANSI escape sequences in the message are neutralized', () => {
  const { log, stdout } = createTestLogger();
  log.info('\x1b[31mFAKE RED TEXT\x1b[0m');
  assert.doesNotMatch(stdout.lines[0], /\x1b/);
  assert.match(stdout.lines[0], /\\x1b\[31mFAKE RED TEXT\\x1b\[0m/);
});

test('pretty mode: tabs are rendered as a visible escape rather than a raw control character', () => {
  const { log, stdout } = createTestLogger();
  log.info('a\tb');
  assert.doesNotMatch(stdout.lines[0], /a\tb/);
  assert.match(stdout.lines[0], /a\\tb/);
});

test('pretty mode: normal printable Unicode passes through untouched', () => {
  const { log, stdout } = createTestLogger();
  log.info('日本語 emoji \u{1F389} café');
  assert.match(stdout.lines[0], /日本語 emoji \u{1F389} café/u);
});

test('pretty mode: an ordinary message with no control characters is unaffected', () => {
  const { log, stdout } = createTestLogger();
  log.info('server started on port 3000');
  assert.match(stdout.lines[0], /server started on port 3000/);
});

test('pretty mode: newline injection via a metadata value is also neutralized', () => {
  const { log, stdout } = createTestLogger();
  log.info('login attempt', { username: 'evil\nFAKE fatal: system compromised' });
  assert.equal(stdout.lines.length, 1);
});

test('pretty mode: ANSI injection via a metadata value with no surrounding whitespace is neutralized', () => {
  const { log, stdout } = createTestLogger();
  // No spaces around the escape codes, so this previously skipped the
  // "contains whitespace -> JSON.stringify" quoting path entirely.
  log.info('login attempt', { username: '\x1b[31mADMIN\x1b[0m' });
  assert.doesNotMatch(stdout.lines[0], /\x1b/);
});

test('pretty mode: a raw newline embedded in an error message does not defeat indentation', () => {
  const { log, stderr } = createTestLogger();
  log.error('request failed', new Error('bad input\nFAKE fatal: system compromised'));
  // Real stack traces are legitimately multi-line, so the injected newline
  // does still start a new physical line — but every line of the error body
  // is indented, so it can't masquerade as an unindented, top-level entry.
  const bodyLines = stderr.raw.split('\n').slice(1).filter(Boolean);
  assert.ok(bodyLines.length > 0);
  for (const line of bodyLines) assert.match(line, /^\s\s/);
});

test('pretty mode: an ANSI escape embedded in an error message is neutralized even though it rides along inside error.stack', () => {
  const { log, stderr } = createTestLogger();
  log.error('request failed', new Error('bad input\x1b[31mFAKE\x1b[0m'));
  assert.doesNotMatch(stderr.raw, /\x1b/);
  assert.match(stderr.raw, /\\x1b\[31mFAKE\\x1b\[0m/);
});

test('pretty mode: a bare carriage return in an error message cannot visually erase the indent', () => {
  const { log, stderr } = createTestLogger();
  log.error('request failed', new Error('bad input\rFAKE'));
  assert.doesNotMatch(stderr.raw, /\r/);
  assert.match(stderr.raw, /bad input\\rFAKE/);
});

test('pretty mode: a normal error still renders its full multi-line stack trace, indented', () => {
  const { log, stderr } = createTestLogger();
  log.error('request failed', new Error('boom'));
  assert.match(stderr.raw, /Error: boom/);
  // A real stack has multiple " at ..." frames — confirm we didn't collapse
  // legitimate newlines along with the sanitization.
  assert.ok(stderr.raw.split('\n').length > 2);
});

test('JSON mode remains valid JSON when the message contains control characters', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  const raw = 'line one\nline two\x1b[31m\r\tend';
  log.info(raw);
  assert.equal(stdout.lines.length, 1);
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.message, raw);
});

test('JSON mode remains valid JSON when metadata contains control characters', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  const raw = 'a\nb\x1b[31m\rc';
  log.info('x', { note: raw });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.note, raw);
});

test('redaction does not crash on an extremely deep object (pre-fix: stack overflow)', () => {
  const r = new Redactor(['password']);
  let obj = { password: 'leaf' };
  for (let i = 0; i < 5000; i++) obj = { child: obj };
  assert.doesNotThrow(() => r.redact(obj));
});

test('redaction does not crash on an extremely deep array (pre-fix: stack overflow)', () => {
  const r = new Redactor(['password']);
  let arr = [{ password: 'leaf' }];
  for (let i = 0; i < 5000; i++) arr = [arr];
  assert.doesNotThrow(() => r.redact(arr));
});

test('redaction still fully redacts within normal nesting depth', () => {
  const r = new Redactor(['password']);
  const obj = { a: { b: { c: { password: 'secret' } } } };
  const result = r.redact(obj);
  assert.equal(result.a.b.c.password, '[REDACTED]');
});

test('the depth-limit marker appears once the limit is exceeded, applied consistently to objects', () => {
  const r = new Redactor(['password']);
  let obj = { password: 'leaf' };
  for (let i = 0; i < MAX_REDACT_DEPTH + 10; i++) obj = { child: obj };

  const result = r.redact(obj);
  let cur = result;
  let hitMarker = false;
  for (let i = 0; i < MAX_REDACT_DEPTH + 10; i++) {
    if (cur === DEPTH_LIMIT_MARKER) {
      hitMarker = true;
      break;
    }
    cur = cur.child;
  }
  assert.equal(hitMarker, true);
});

test('the depth-limit marker applies consistently to arrays too', () => {
  const r = new Redactor(['password']);
  let arr = ['leaf'];
  for (let i = 0; i < MAX_REDACT_DEPTH + 10; i++) arr = [arr];

  const result = r.redact(arr);
  let cur = result;
  let hitMarker = false;
  for (let i = 0; i < MAX_REDACT_DEPTH + 10; i++) {
    if (cur === DEPTH_LIMIT_MARKER) {
      hitMarker = true;
      break;
    }
    cur = cur[0];
  }
  assert.equal(hitMarker, true);
});

test('circular-reference detection still works alongside the new depth limit', () => {
  const r = new Redactor(['password']);
  const obj = { password: 'secret', self: null };
  obj.self = obj;
  const result = r.redact(obj);
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.self, '[Circular]');
});

test('a circular reference inside a deep-but-under-the-limit structure is still detected', () => {
  const r = new Redactor(['password']);
  const cycle = { password: 'secret' };
  let obj = cycle;
  for (let i = 0; i < MAX_REDACT_DEPTH - 2; i++) obj = { child: obj };
  cycle.back = obj; // close the loop well within the depth limit

  assert.doesNotThrow(() => r.redact(obj));
});

test('redacting a deeply nested object does not mutate the caller-provided object', () => {
  const r = new Redactor(['password']);
  let obj = { password: 'leaf' };
  for (let i = 0; i < 30; i++) obj = { child: obj };
  const before = JSON.stringify(obj);
  r.redact(obj);
  assert.equal(JSON.stringify(obj), before);
});

test('JSON output includes pid and hostname', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  log.info('hello');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.pid, process.pid);
  assert.equal(parsed.hostname, os.hostname());
});

test('pretty output is unchanged by the pid/hostname addition', () => {
  const { log, stdout } = createTestLogger();
  log.info('hello');
  assert.doesNotMatch(stdout.lines[0], /hostname/);
});

test('metadata named "pid" or "hostname" is namespaced instead of overwriting the process fields', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  log.info('x', { pid: 'fake-pid', hostname: 'fake-host' });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.pid, process.pid);
  assert.equal(parsed.hostname, os.hostname());
  assert.equal(parsed.meta_pid, 'fake-pid');
  assert.equal(parsed.meta_hostname, 'fake-host');
});

test('the optimized level check still filters out every level below the threshold', () => {
  const { log, stdout, stderr } = createTestLogger({ level: 'warn' });
  log.debug('nope');
  log.info('nope');
  log.warn('yes');
  log.error('yes');
  assert.equal(stdout.lines.length, 0);
  assert.equal(stderr.lines.length, 2);
});

test('the optimized level check still respects a logger.level mutated after construction', () => {
  const { log, stdout } = createTestLogger({ level: 'error' });
  log.info('nope');
  log.level = 'info';
  log.info('now it should log');
  assert.equal(stdout.lines.length, 1);
});

test('once() still works correctly (exercises the unshared _log validity check)', () => {
  const { log, stderr } = createTestLogger();
  log.once('k', 'first');
  log.once('k', 'second');
  assert.equal(stderr.lines.length, 1);
});
