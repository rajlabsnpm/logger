'use strict';

const { formatPretty, formatJson } = require('./formatter');
const { DEFAULT_LEVELS } = require('./levels');

const DEFAULT_STDERR_LEVELS = new Set(['warn', 'error', 'fatal']);
const DEFAULT_LABEL_WIDTH = Math.max(...Object.values(DEFAULT_LEVELS).map((l) => l.label.length));

function resolveColors(colorsOption, stream) {
  if (process.env.NO_COLOR) return false;
  if (colorsOption === false) return false;
  if (colorsOption === true) return true;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}

/**
 * The default console transport. It's exported so you can toss it into a custom
 * transport list if you want to be fancy. It also knows how to render custom levels
 * when the logger hands it the resolved table.
 */
function consoleTransport(options = {}) {
  const format = options.format === 'json' ? 'json' : 'pretty';
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const stderrLevels = options.stderrLevels || DEFAULT_STDERR_LEVELS;
  const colorsOption = options.colors;
  const levels = options.levels || DEFAULT_LEVELS;
  const labelWidth = options.labelWidth || DEFAULT_LABEL_WIDTH;

  return {
    log(entry) {
      const stream = stderrLevels.has(entry.level) ? stderr : stdout;

      let line;
      try {
        if (format === 'json') {
          line = formatJson(entry);
        } else {
          const useColors = resolveColors(colorsOption, stream);
          line = formatPretty(entry, useColors, levels, labelWidth);
        }
      } catch (err) {
        line = `[logger-internal-error] failed to format log entry (${err && err.message})`;
      }

      stream.write(line + '\n');
    },
  };
}

function isValidTransport(transport) {
  return Boolean(transport) && typeof transport.log === 'function';
}

function validateTransports(transports) {
  if (!Array.isArray(transports)) {
    throw new TypeError('createLogger({ transports }) must be an array of transport objects');
  }
  for (const transport of transports) {
    if (!isValidTransport(transport)) {
      throw new TypeError('Every transport must be an object with a log(entry) method');
    }
  }
  return transports;
}

module.exports = { consoleTransport, resolveColors, validateTransports, DEFAULT_STDERR_LEVELS };
