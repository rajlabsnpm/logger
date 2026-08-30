'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('CJS require exposes createLogger, LEVELS, LEVEL_ORDER, consoleTransport, VERSION', () => {
  const mod = require('../src/index.js');
  assert.equal(typeof mod.createLogger, 'function');
  assert.equal(typeof mod.LEVELS, 'object');
  assert.ok(Array.isArray(mod.LEVEL_ORDER));
  assert.equal(typeof mod.consoleTransport, 'function');
  assert.equal(typeof mod.VERSION, 'string');
});

test('ESM import exposes the same named exports plus a default export', async () => {
  const mod = await import('../src/index.mjs');
  assert.equal(typeof mod.createLogger, 'function');
  assert.equal(typeof mod.LEVELS, 'object');
  assert.ok(Array.isArray(mod.LEVEL_ORDER));
  assert.equal(typeof mod.consoleTransport, 'function');
  assert.equal(typeof mod.VERSION, 'string');
  assert.equal(typeof mod.default.createLogger, 'function');
});

test('a logger created via the ESM entry point behaves like one created via CJS', async () => {
  const { createLogger } = await import('../src/index.mjs');
  const chunks = [];
  const stdout = {
    isTTY: false,
    write(c) {
      chunks.push(c);
      return true;
    },
  };
  const log = createLogger({ stdout, timestamp: false, format: 'json' });
  log.info('hello from esm', { via: 'esm' });
  const parsed = JSON.parse(chunks.join('').trim());
  assert.equal(parsed.message, 'hello from esm');
  assert.equal(parsed.via, 'esm');
});
