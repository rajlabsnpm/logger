'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLogger } = require('../src/index.js');
const { resolveVersion, resolveDeployment } = require('../src/metadata');

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

test('by default, version is auto-detected from the nearest package.json (process cwd)', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  log.info('x');
  const parsed = JSON.parse(stdout.lines[0]);
  const pkg = require('../package.json');
  assert.equal(parsed.version, pkg.version);
});

test('an explicit version option overrides auto-detection', () => {
  const { log, stdout } = createTestLogger({ format: 'json', version: '9.9.9-canary' });
  log.info('x');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.version, '9.9.9-canary');
});

test('version: false disables version metadata entirely, no auto-detection fallback', () => {
  const { log, stdout } = createTestLogger({ format: 'json', version: false });
  log.info('x');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'version'), false);
});

test('deployment is omitted by default (no platform-specific auto-detection)', () => {
  const { log, stdout } = createTestLogger({ format: 'json' });
  log.info('x');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'deployment'), false);
});

test('an explicit deployment option is attached to every entry', () => {
  const { log, stdout, stderr } = createTestLogger({ format: 'json', deployment: 'blue-7f3a2c1' });
  log.info('x');
  log.warn('y'); // routed to stderr by default
  assert.equal(JSON.parse(stdout.lines[0]).deployment, 'blue-7f3a2c1');
  assert.equal(JSON.parse(stderr.lines[0]).deployment, 'blue-7f3a2c1');
});

test('pretty mode does not print version/deployment (same treatment as pid/hostname)', () => {
  const { log, stdout } = createTestLogger({ version: '1.2.3', deployment: 'green' });
  log.info('hello');
  assert.doesNotMatch(stdout.lines[0], /1\.2\.3/);
  assert.doesNotMatch(stdout.lines[0], /green/);
});

test('a metadata field literally named "version" does not collide with the reserved key', () => {
  const { log, stdout } = createTestLogger({ format: 'json', version: '1.0.0' });
  log.info('x', { version: 'my-own-field' });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.version, '1.0.0');
  assert.equal(parsed.meta_version, 'my-own-field');
});

test('a garbage-typed version option falls back to auto-detection instead of throwing', () => {
  assert.doesNotThrow(() => createLogger({ version: 12345 }));
  const { log, stdout } = createTestLogger({ format: 'json', version: 12345 });
  log.info('x');
  const parsed = JSON.parse(stdout.lines[0]);
  const pkg = require('../package.json');
  assert.equal(parsed.version, pkg.version);
});

test('resolveVersion(cwd) returns undefined for a directory with no package.json', () => {
  assert.equal(resolveVersion(undefined, path.join(__dirname, '..', '..')), undefined);
});

test('resolveDeployment ignores non-string / empty values', () => {
  assert.equal(resolveDeployment(undefined), undefined);
  assert.equal(resolveDeployment(''), undefined);
  assert.equal(resolveDeployment(42), undefined);
  assert.equal(resolveDeployment('canary'), 'canary');
});
