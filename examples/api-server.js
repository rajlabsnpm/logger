'use strict';

const http = require('node:http');
const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API', format: 'json' });

// log.middleware() works as a raw http.createServer request listener: since
// no `next` is passed by Node, we wrap it ourselves and call our own handler.
const requestLogger = log.middleware({
  ignore: ['/health'],
});

function handleRequest(req, res) {
  // Ambient request context (requestId) is already active here thanks to
  // the middleware, so any log call made from deeper in the call stack
  // automatically includes it — no need to pass `log` around explicitly.
  log.info('Handling request', { method: req.method });

  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  if (req.url === '/users') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: [] }));
    return;
  }

  if (req.url === '/boom') {
    log.error('Unhandled error while serving /boom', new Error('simulated failure'));
    res.writeHead(500);
    res.end('internal error');
    return;
  }

  res.writeHead(404);
  res.end('not found');
}

const server = http.createServer((req, res) => {
  requestLogger(req, res, () => handleRequest(req, res));
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  log.info('Server listening', { port });
});
