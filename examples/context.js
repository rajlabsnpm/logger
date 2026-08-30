'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API', format: 'json' });

// withContext(): a persistent logger view carrying fixed fields
const requestLog = log.withContext({ requestId: 'req_abc123', userId: 42 });
requestLog.info('Fetching user');
requestLog.info('User found');

// runWithContext(): ambient context via AsyncLocalStorage, no logger
// reference needs to be threaded through your call stack.
async function handleRequest() {
  log.info('Handling request'); // picks up ambient context automatically
  await new Promise((resolve) => setTimeout(resolve, 10));
  log.info('Request handled');
}

log.runWithContext({ requestId: 'req_def456' }, () => {
  handleRequest();
});
