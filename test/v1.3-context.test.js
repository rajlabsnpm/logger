'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLogger } = require('../src/index.js');
const { resolveIncomingRequestId, generateRequestId, defaultStatusLevel } = require('../src/context');

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
  const log = createLogger({ ...options, stdout, stderr, timestamp: false, format: 'json' });
  return { log, stdout, stderr };
}

function fakeReqRes({ method = 'GET', url = '/', status = 200, headers = {} } = {}) {
  const req = { method, url, headers };
  const res = new EventEmitter();
  res.statusCode = status;
  return { req, res };
}

// --- runWithContext / AsyncLocalStorage -------------------------------------

test('runWithContext attaches fields to every log call made inside it', () => {
  const { log, stdout } = createTestLogger();
  log.runWithContext({ requestId: 'req_1' }, () => {
    log.info('inside');
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'req_1');
});

test('the request context survives await/async gaps', async () => {
  const { log, stdout } = createTestLogger();
  await log.runWithContext({ requestId: 'req_async' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    log.info('after await');
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'req_async');
});

test('the request context survives nested async callbacks and timers', async () => {
  const { log, stdout } = createTestLogger();
  await log.runWithContext({ requestId: 'req_nested' }, () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        Promise.resolve().then(() => {
          log.info('deeply nested');
          resolve();
        });
      }, 5);
    });
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'req_nested');
});

test('logging outside any runWithContext has no ambient context', () => {
  const { log, stdout } = createTestLogger();
  log.info('no context');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal('requestId' in parsed, false);
});

test('nested runWithContext calls merge, with the inner context winning on collisions', () => {
  const { log, stdout } = createTestLogger();
  log.runWithContext({ requestId: 'outer', a: 1 }, () => {
    log.runWithContext({ requestId: 'inner' }, () => {
      log.info('nested');
    });
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'inner');
  assert.equal(parsed.a, 1);
});

test('the outer context is restored after a nested runWithContext returns', () => {
  const { log, stdout } = createTestLogger();
  log.runWithContext({ requestId: 'outer' }, () => {
    log.runWithContext({ requestId: 'inner' }, () => {});
    log.info('back to outer');
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'outer');
});

test('runWithContext requires a function', () => {
  const { log } = createTestLogger();
  assert.throws(() => log.runWithContext({}, 'nope'), TypeError);
});

test('child loggers see the same ambient request context', () => {
  const { log, stdout } = createTestLogger({ name: 'API' });
  const child = log.child('DB');
  log.runWithContext({ requestId: 'req_1' }, () => {
    child.info('query');
  });
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'req_1');
  assert.equal(parsed.name, 'API:DB');
});

// --- request ID generation ---------------------------------------------

test('generateRequestId() produces a "req_" prefixed id', () => {
  const id = generateRequestId();
  assert.match(id, /^req_[a-f0-9]+$/);
});

test('resolveIncomingRequestId trusts a well-formed incoming header by default', () => {
  const req = { headers: { 'x-request-id': 'abc-123_DEF' } };
  assert.equal(resolveIncomingRequestId(req), 'abc-123_DEF');
});

test('resolveIncomingRequestId rejects a malformed header value and generates a fresh id', () => {
  const req = { headers: { 'x-request-id': 'not valid! <script>' } };
  const id = resolveIncomingRequestId(req);
  assert.match(id, /^req_[a-f0-9]+$/);
});

test('resolveIncomingRequestId can be configured not to trust the header at all', () => {
  const req = { headers: { 'x-request-id': 'abc-123' } };
  const id = resolveIncomingRequestId(req, { trustHeader: false });
  assert.match(id, /^req_[a-f0-9]+$/);
});

test('resolveIncomingRequestId respects a custom header name', () => {
  const req = { headers: { 'x-trace-id': 'trace-1' } };
  assert.equal(resolveIncomingRequestId(req, { header: 'x-trace-id' }), 'trace-1');
});

test('defaultStatusLevel maps status codes to sensible levels', () => {
  assert.equal(defaultStatusLevel(200), 'info');
  assert.equal(defaultStatusLevel(301), 'info');
  assert.equal(defaultStatusLevel(404), 'warn');
  assert.equal(defaultStatusLevel(500), 'error');
});

// --- middleware --------------------------------------------------------

test('requestContext() middleware injects a requestId and calls next()', () => {
  const { log } = createTestLogger();
  const mw = log.requestContext();
  const { req, res } = fakeReqRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.match(req.requestId, /^req_/);
});

test('requestContext() reuses a valid incoming X-Request-ID', () => {
  const { log, stdout } = createTestLogger();
  const mw = log.requestContext();
  const { req, res } = fakeReqRes({ headers: { 'x-request-id': 'upstream-id-1' } });
  mw(req, res, () => log.info('inside'));
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.requestId, 'upstream-id-1');
});

test('middleware() logs method/path/status/duration/requestId on response finish', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware();
  const { req, res } = fakeReqRes({ method: 'GET', url: '/users', status: 200 });

  await new Promise((resolve) => {
    mw(req, res, () => {
      setTimeout(() => {
        res.emit('finish');
        resolve();
      }, 5);
    });
  });

  const line = JSON.parse(stdout.lines[stdout.lines.length - 1]);
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/users');
  assert.equal(line.status, 200);
  assert.ok(line.duration >= 0);
  assert.match(line.requestId, /^req_/);
});

test('middleware() uses warn for 4xx and error for 5xx responses', async () => {
  const { log, stdout, stderr } = createTestLogger();
  const mw = log.middleware();

  const { req: req1, res: res1 } = fakeReqRes({ status: 404 });
  await new Promise((resolve) => mw(req1, res1, () => (res1.emit('finish'), resolve())));

  const { req: req2, res: res2 } = fakeReqRes({ status: 500 });
  await new Promise((resolve) => mw(req2, res2, () => (res2.emit('finish'), resolve())));

  assert.equal(stdout.lines.length, 0);
  assert.equal(stderr.lines.length, 2);
  const warnLine = JSON.parse(stderr.lines[0]);
  const errorLine = JSON.parse(stderr.lines[1]);
  assert.equal(warnLine.level, 'warn');
  assert.equal(errorLine.level, 'error');
});

test('middleware() respects the ignore option', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware({ ignore: ['/health'] });
  const { req, res } = fakeReqRes({ url: '/health' });
  await new Promise((resolve) => mw(req, res, () => (res.emit('finish'), resolve())));
  assert.equal(stdout.lines.length, 0);
});

test('middleware() can be disabled entirely, leaving only context propagation', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware({ enabled: false });
  const { req, res } = fakeReqRes();
  let sawContext = false;
  await new Promise((resolve) => {
    mw(req, res, () => {
      log.info('inside');
      sawContext = true;
      res.emit('finish');
      resolve();
    });
  });
  assert.equal(sawContext, true);
  assert.equal(stdout.lines.length, 1); // only the manual log.info, no auto request log
});

test('middleware() supports custom fields via a fields() function', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware({ fields: (req) => ({ userAgent: req.headers['user-agent'] || 'unknown' }) });
  const { req, res } = fakeReqRes({ headers: { 'user-agent': 'test-agent' } });
  await new Promise((resolve) => mw(req, res, () => (res.emit('finish'), resolve())));
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.userAgent, 'test-agent');
});

test('middleware() works as a raw request listener with no next() argument', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware();
  const { req, res } = fakeReqRes({ url: '/raw' });
  mw(req, res); // no third argument, like server.on('request', mw)
  await new Promise((resolve) => setTimeout(resolve, 5));
  res.emit('finish');
  const parsed = JSON.parse(stdout.lines[0]);
  assert.equal(parsed.path, '/raw');
});

test('middleware() never logs request bodies', async () => {
  const { log, stdout } = createTestLogger();
  const mw = log.middleware();
  const { req, res } = fakeReqRes();
  req.body = { password: 'super-secret-body-field' };
  await new Promise((resolve) => mw(req, res, () => (res.emit('finish'), resolve())));
  assert.doesNotMatch(stdout.lines[0], /super-secret-body-field/);
});
