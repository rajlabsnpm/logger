'use strict';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isCI() {
  return Boolean(process.env.CI) && process.env.CI !== 'false' && process.env.CI !== '0';
}

/**
 * Auto level, but like a responsible adult:
 *   - prod or CI: "info"
 *   - everywhere else: "debug"
 */
function resolveAutoLevel() {
  if (isProduction() || isCI()) return 'info';
  return 'debug';
}

/**
 * Auto format:
 *   - prod: json
 *   - CI: json
 *   - real TTY: pretty
 *   - otherwise: json, because nobody wants a rainbow in a log file
 */
function resolveAutoFormat(stream) {
  if (isProduction()) return 'json';
  if (isCI()) return 'json';
  if (stream && stream.isTTY) return 'pretty';
  return 'json';
}

module.exports = { isProduction, isCI, resolveAutoLevel, resolveAutoFormat };
