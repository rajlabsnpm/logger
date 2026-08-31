'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

// We only trust a very boring request ID shape. If the proxy sends chaos, we toss it and generate a fresh one instead of shoving attacker garbage into the logs.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function generateRequestId() {
  return `req_${crypto.randomBytes(6).toString('hex')}`;
}

function resolveIncomingRequestId(req, options = {}) {
  const headerName = (options.header || 'x-request-id').toLowerCase();
  const trustHeader = options.trustHeader !== false;

  if (trustHeader && req && req.headers && typeof req.headers === 'object') {
    const raw = req.headers[headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) {
      return value;
    }
  }

  return generateRequestId();
}

function defaultStatusLevel(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

function matchesIgnoreRule(url, req, rule) {
  if (typeof rule === 'function') return Boolean(rule(req));
  if (rule instanceof RegExp) return rule.test(url);
  if (typeof rule === 'string') return url === rule || url.startsWith(rule);
  return false;
}

function shouldIgnoreRoute(req, ignore) {
  if (!ignore) return false;
  const url = req.originalUrl || req.url || '';
  const rules = Array.isArray(ignore) ? ignore : [ignore];
  return rules.some((rule) => matchesIgnoreRule(url, req, rule));
}

/**
 * This just carries a request ID around while the request is alive.
 * No logging spam, no drama. Works with Express or a plain Node server.
 */
function createRequestContextMiddleware(logger, options = {}) {
  const requestIdOptions = options.requestId || {};

  return function requestContextMiddleware(req, res, next) {
    const requestId = resolveIncomingRequestId(req, requestIdOptions);
    if (req) req.requestId = requestId;

    const extraFields = typeof options.fields === 'function' ? options.fields(req, res) : undefined;
    const contextFields = Object.assign({ requestId }, extraFields);

    logger.runWithContext(contextFields, () => {
      if (typeof next === 'function') next();
    });
  };
}

/**
 * Request logging with a tiny "here's what happened" line at the end.
 * Method, path, status, and how long the whole thing took.
 */
function createRequestLoggingMiddleware(logger, options = {}) {
  const contextMiddleware = createRequestContextMiddleware(logger, options);
  const enabled = options.enabled !== false;
  const fixedLevel = options.level;
  const statusLevel = typeof options.statusLevel === 'function' ? options.statusLevel : defaultStatusLevel;
  const ignore = options.ignore;

  return function requestLoggingMiddleware(req, res, next) {
    if (!enabled || shouldIgnoreRoute(req, ignore)) {
      contextMiddleware(req, res, next);
      return;
    }

    const start = process.hrtime.bigint();

    contextMiddleware(req, res, () => {
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const status = res.statusCode;
        const resolvedLevel = fixedLevel && typeof logger[fixedLevel] === 'function' ? fixedLevel : statusLevel(status);
        const logMethod = typeof logger[resolvedLevel] === 'function' ? resolvedLevel : 'info';
        const extraFields = typeof options.fields === 'function' ? options.fields(req, res) : undefined;
        const path = req.originalUrl || req.url || '';

        logger[logMethod](
          `${req.method} ${path}`,
          Object.assign(
            {
              method: req.method,
              path,
              status,
              duration: Math.round(durationMs * 100) / 100,
            },
            extraFields
          )
        );
      });

      if (typeof next === 'function') next();
    });
  };
}

module.exports = {
  AsyncLocalStorage,
  generateRequestId,
  resolveIncomingRequestId,
  defaultStatusLevel,
  createRequestContextMiddleware,
  createRequestLoggingMiddleware,
};
