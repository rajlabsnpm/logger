'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({
  name: 'API',
  redact: ['password', 'token', 'user.ssn', '*.authorization'],
});

log.info('User login', {
  username: 'raj',
  password: 'super-secret',
  token: 'abc123',
  user: { ssn: '123-45-6789', email: 'raj@example.com' },
  request: { authorization: 'Bearer xyz' },
});

// redact: true turns on the built-in sensitive-key defaults
const defaultRedactLog = createLogger({ redact: true });
defaultRedactLog.info('Third-party API response', {
  apiKey: 'sk_live_abc123',
  accessToken: 'tok_xyz',
  status: 'ok',
});
