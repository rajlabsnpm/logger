'use strict';

const { bench, loggerWith } = require('./_util');

const N = 500_000;

const small = loggerWith({ format: 'json' });
bench('small metadata (3 fields)', N, () => small.info('event', { a: 1, b: 'two', c: true }));

const large = loggerWith({ format: 'json' });
const largeMeta = {};
for (let i = 0; i < 50; i++) largeMeta[`field${i}`] = i;
bench('large metadata (50 fields)', N, () => large.info('event', largeMeta));

const nested = loggerWith({ format: 'json' });
const nestedMeta = { user: { id: 1, profile: { name: 'Raj', roles: ['admin', 'user'] } }, tags: [1, 2, 3, 4, 5] };
bench('nested metadata (objects + arrays)', N, () => nested.info('event', nestedMeta));

const withContext = loggerWith({ format: 'json' }).withContext({ requestId: 'req_123', userId: 42 });
bench('withContext + explicit metadata', N, () => withContext.info('event', { status: 200 }));
