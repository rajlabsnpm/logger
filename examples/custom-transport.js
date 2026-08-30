'use strict';

const { createLogger, consoleTransport } = require('../src/index.js');

// Any object with a log(entry) method is a valid transport. Transports can
// optionally implement flush()/close() for cleanup on shutdown.
function inMemoryTransport(buffer) {
  return {
    log(entry) {
      buffer.push(entry);
    },
    flush() {
      // e.g. batch-send buffered entries somewhere
    },
    close() {
      buffer.length = 0;
    },
  };
}

const captured = [];

const log = createLogger({
  name: 'API',
  // combine the built-in console transport with a custom one
  transports: [consoleTransport({ format: 'pretty' }), inMemoryTransport(captured)],
  hooks: {
    before(entry) {
      // hooks can inspect/mutate every entry before it reaches transports
      entry.metadata = Object.assign({ hostname: 'worker-1' }, entry.metadata);
      return entry;
    },
  },
});

log.info('Server started', { port: 3000 });
log.warn('Cache miss', { key: 'user:42' });

console.log('\nCaptured in memory:', JSON.stringify(captured, null, 2));

log.flush();
log.close();
