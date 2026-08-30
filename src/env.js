'use strict';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isCI() {
  return Boolean(process.env.CI) && process.env.CI !== 'false' && process.env.CI !== '0';
}

/**
 * `level: "auto"` — conservative and boring on purpose:
 *   - production or CI: "info" (debug noise doesn't belong in prod logs)
 *   - everything else: "debug" (matches the existing default)
 */
function resolveAutoLevel() {
  if (isProduction() || isCI()) return 'info';
  return 'debug';
}

/**
 * `format: "auto"`:
 *   - production: "json" (structured logs for aggregation)
 *   - CI: "json" (CI log viewers are usually plain text, not real TTYs)
 *   - a real TTY: "pretty"
 *   - anything else (piped to a file, non-interactive shell): "json"
 */
function resolveAutoFormat(stream) {
  if (isProduction()) return 'json';
  if (isCI()) return 'json';
  if (stream && stream.isTTY) return 'pretty';
  return 'json';
}

module.exports = { isProduction, isCI, resolveAutoLevel, resolveAutoFormat };
