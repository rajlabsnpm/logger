'use strict';

const LEVELS = {
  debug: { value: 10, label: 'DEBUG', color: 'gray' },
  info: { value: 20, label: 'INFO', color: 'cyan' },
  success: { value: 25, label: 'SUCCESS', color: 'green' },
  warn: { value: 30, label: 'WARN', color: 'yellow' },
  error: { value: 40, label: 'ERROR', color: 'red' },
};

// sort once; this is what makes the level gate actually work.
const LEVEL_ORDER = Object.keys(LEVELS).sort((a, b) => LEVELS[a].value - LEVELS[b].value);

function isValidLevel(level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, level);
}

function shouldLog(currentLevel, messageLevel) {
  return LEVELS[messageLevel].value >= LEVELS[currentLevel].value;
}

module.exports = {
  LEVELS,
  LEVEL_ORDER,
  isValidLevel,
  shouldLog,
};
