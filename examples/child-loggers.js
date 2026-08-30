'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API' });

const dbLog = log.child('Database');
const authLog = log.child('Auth');

dbLog.info('Connected to postgres://localhost:5432');
authLog.info('User authenticated', { userId: 42 });

const nested = dbLog.child('Migrations');
nested.info('Running pending migrations');
