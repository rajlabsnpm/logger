'use strict';

const { LEVEL_ORDER, isValidLevel, shouldLog } = require('./levels');
const { formatPretty, formatJson } = require('./formatter');

const DEFAULT_LEVEL = 'debug';
const DEFAULT_FORMAT = 'pretty';
const STDERR_LEVELS = new Set(['warn', 'error']);

function resolveColors(colorsOption, stream) {
  if (process.env.NO_COLOR) return false;
  if (colorsOption === false) return false;
  if (colorsOption === true) return true;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}

class Logger {
  constructor(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};

    this.name = typeof opts.name === 'string' ? opts.name : '';
    this.level = isValidLevel(opts.level) ? opts.level : DEFAULT_LEVEL;
    this.timestamp = opts.timestamp !== false;
    this.format = opts.format === 'json' ? 'json' : DEFAULT_FORMAT;
    this.colorsOption = opts.colors;

    this._stdout = opts.stdout || process.stdout;
    this._stderr = opts.stderr || process.stderr;

    for (const levelName of LEVEL_ORDER) {
      this[levelName] = (message, meta) => this._log(levelName, message, meta);
    }
  }

  child(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('logger.child(name) requires a non-empty string');
    }

    const childName = this.name ? `${this.name}:${name}` : name;

    return new Logger({
      name: childName,
      level: this.level,
      timestamp: this.timestamp,
      format: this.format,
      colors: this.colorsOption,
      stdout: this._stdout,
      stderr: this._stderr,
    });
  }

  _log(level, message, meta) {
    if (!isValidLevel(level) || !shouldLog(this.level, level)) return;

    // warn/error go to stderr so the normal stream stays readable.
    const stream = STDERR_LEVELS.has(level) ? this._stderr : this._stdout;

    let line;
    try {
      if (this.format === 'json') {
        line = formatJson({
          level,
          message,
          meta,
          name: this.name,
          timestamp: this.timestamp,
        });
      } else {
        const useColors = resolveColors(this.colorsOption, stream);
        line = formatPretty(
          { level, message, meta, name: this.name, timestamp: this.timestamp },
          useColors
        );
      }
    } catch (err) {
      line = `[logger-internal-error] failed to format log entry (${err && err.message})`;
    }

    stream.write(line + '\n');
  }
}

module.exports = { Logger };
