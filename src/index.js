'use strict';

const { Logger } = require('./logger');
const { LEVELS, LEVEL_ORDER } = require('./levels');

function createLogger(options) {
  return new Logger(options);
}

module.exports = {
  createLogger,
  LEVELS,
  LEVEL_ORDER,
};
