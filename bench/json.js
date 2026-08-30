'use strict';

const { bench, loggerWith } = require('./_util');

const N = 1_000_000;

const json = loggerWith({ format: 'json' });
bench('JSON info (no metadata)', N, () => json.info('server started'));

const jsonWithMeta = loggerWith({ format: 'json' });
bench('JSON info with small metadata', N, () => jsonWithMeta.info('request handled', { status: 200, ms: 12 }));

const jsonError = loggerWith({ format: 'json' });
const err = new Error('boom');
bench('JSON error with a real Error', N, () => jsonError.error('request failed', err));
