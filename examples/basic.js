'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API' });

log.debug('Debug information');
log.info('Server started', { port: 3000 });
log.success('Database connected');
log.warn('Using development configuration');
log.error('Something went wrong', new Error('example error'));
log.fatal('Application cannot continue');
