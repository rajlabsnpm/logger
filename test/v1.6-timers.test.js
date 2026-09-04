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

// This must run before any other test in this file pushes the registry past
// the threshold, since the underlying warnOnce() is deduped process-wide.
test('crossing the timer registry warn threshold emits exactly one warning', () => {
  const { log } = createTestLogger();
  const captured = withStderrSpy(() => {
    for (let i = 0; i < 10000; i++) log.time(`leaked-${i}`);
  });
  const matches = captured.match(/timer registry has grown/g) || [];
  assert.equal(matches.length, 1);
});

test('the guard never deletes or otherwise touches any timer', () => {
  const { log } = createTestLogger();
  const timers = [];
  for (let i = 0; i < 10050; i++) timers.push(log.time(`t-${i}`));
  assert.equal(log._core.timers.size, 10050);
  // ending one after crossing the threshold still behaves normally
  timers[10049].end();
  assert.equal(log._core.timers.size, 10049);
});

test('properly-ended timers never trip the guard, no matter how many are created', () => {
  const { log } = createTestLogger();
  const captured = withStderrSpy(() => {
    for (let i = 0; i < 12000; i++) {
      const t = log.time('reused-label');
      t.end();
    }
  });
  assert.doesNotMatch(captured, /timer registry has grown/);
  assert.equal(log._core.timers.size, 0);
});

test('normal, low-volume timer usage is completely unaffected', () => {
  const { log, stdout } = createTestLogger();
  const timer = log.time('quick-op');
  timer.end();
  assert.equal(stdout.lines.length, 1);
  assert.match(stdout.lines[0], /quick-op completed/);
  assert.equal(log._core.timers.size, 0);
});
