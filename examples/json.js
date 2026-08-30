'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API', format: 'json' });

log.info('Server started', { port: 3000, environment: 'production' });
log.warn('Slow query detected', { queryMs: 842, table: 'orders' });
log.error('Payment failed', new Error('card declined'));
