'use strict';

const { bench, loggerWith } = require('./_util');

const N = 500_000;

const noContext = loggerWith({ format: 'json' });
bench('no context', N, () => noContext.info('event'));

const persistentContext = loggerWith({ format: 'json' }).withContext({ requestId: 'req_123' });
bench('withContext (persistent)', N, () => persistentContext.info('event'));

const alsLogger = loggerWith({ format: 'json' });
bench('runWithContext (AsyncLocalStorage)', N, () => {
  alsLogger.runWithContext({ requestId: 'req_123' }, () => {
    alsLogger.info('event');
  });
});

const sampled = loggerWith({ format: 'json', sampling: { debug: 0.1 } });
bench('sampled debug (90% dropped)', N, () => sampled.debug('noisy event'));
