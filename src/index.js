'use strict';

const { Logger } = require('./logger');
const { LEVELS, LEVEL_ORDER } = require('./levels');
const { consoleTransport } = require('./transports');
const { DEFAULT_REDACT_KEYS } = require('./redact');

function createLogger(options) {
  return new Logger(options);
}

module.exports = {
  createLogger,
  LEVELS,
  LEVEL_ORDER,
  consoleTransport,
  DEFAULT_REDACT_KEYS,
  VERSION: require('../package.json').version,
};
