'use strict';

const { bench, loggerWith } = require('./_util');

const N = 500_000;

const noRedact = loggerWith({ format: 'json' });
bench('no redaction configured', N, () =>
  noRedact.info('login', { username: 'raj', password: 'secret', token: 'abc' })
);

const withRedact = loggerWith({ format: 'json', redact: ['password', 'token'] });
bench('redaction: 2 flat keys', N, () =>
  withRedact.info('login', { username: 'raj', password: 'secret', token: 'abc' })
);

const withNestedRedact = loggerWith({ format: 'json', redact: ['password'] });
bench('redaction: nested object', N, () =>
  withNestedRedact.info('login', { user: { profile: { password: 'secret' }, name: 'raj' } })
);

const withPathRedact = loggerWith({ format: 'json', redact: ['user.password', '*.token'] });
bench('redaction: path + wildcard rules', N, () =>
  withPathRedact.info('login', { user: { password: 'secret' }, session: { token: 'abc' } })
);
