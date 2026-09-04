'use strict';

const { bench, loggerWith } = require('./_util');

const N = 200_000;

const simple = loggerWith({ format: 'json' });
bench('simple error (name, message, stack)', N, () => simple.error('request failed', new Error('boom')));

const withExtras = loggerWith({ format: 'json' });
bench('error with extra props (redacted)', N, () => {
  const err = new Error('request failed');
  err.statusCode = 500;
  err.config = { headers: { authorization: 'Bearer secret' } };
  withExtras.error('upstream call failed', err);
});

const withCause = loggerWith({ format: 'json' });
bench('error with a cause chain (3 deep)', N, () => {
  const root = new Error('connection refused');
  const middle = new Error('query failed', { cause: root });
  const top = new Error('request failed', { cause: middle });
  withCause.error('request failed', top);
});

// Normal errors should stay quick.
const wellBehaved = loggerWith({ format: 'json' });
class CustomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CustomError';
    this.code = 'ECONNRESET';
  }
}
bench('custom Error subclass with a plain extra prop', N, () =>
  wellBehaved.error('socket error', new CustomError('socket hang up'))
);
