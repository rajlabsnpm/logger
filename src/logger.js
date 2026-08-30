'use strict';

const { resolveLevels, isValidLevel, shouldLog } = require('./levels');
const { Redactor } = require('./redact');
const { Sampler, validateSamplingOption } = require('./sampling');
const { serializeError } = require('./errors');
const { captureSource } = require('./source');
const { createTimer } = require('./timer');
const { consoleTransport, validateTransports } = require('./transports');
const { resolveAutoLevel, resolveAutoFormat } = require('./env');
const {
  AsyncLocalStorage,
  createRequestContextMiddleware,
  createRequestLoggingMiddleware,
} = require('./context');

const warnedOnce = new Set();

function warnOnce(key, message) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  try {
    process.stderr.write(`[@rajlabs/logger] ${message}\n`);
  } catch (err) {
    // if we can't even write to stderr there's nothing left to do
  }
}

function normalizeMeta(meta) {
  if (meta === undefined || meta === null) return { meta: null, error: null };
  if (meta instanceof Error) return { meta: null, error: meta };
  if (typeof meta === 'object' && !Array.isArray(meta)) return { meta, error: null };
  if (Array.isArray(meta)) return { meta: { items: meta }, error: null };
  return { meta: { value: meta }, error: null };
}

function resolveLevelOption(levelOption, core) {
  if (levelOption === 'auto') return resolveAutoLevel();
  if (isValidLevel(core.levels, levelOption)) return levelOption;
  return Object.prototype.hasOwnProperty.call(core.levels, 'debug') ? 'debug' : core.levelOrder[0];
}

function resolveFormatOption(formatOption) {
  if (formatOption === 'auto') return resolveAutoFormat(process.stdout);
  return formatOption === 'json' ? 'json' : 'pretty';
}

function validateHooks(hooks) {
  if (!hooks) return {};
  if (typeof hooks !== 'object') {
    throw new TypeError('createLogger({ hooks }) must be an object');
  }
  if (hooks.before !== undefined && typeof hooks.before !== 'function') {
    throw new TypeError('createLogger({ hooks: { before } }) must be a function');
  }
  if (hooks.after !== undefined && typeof hooks.after !== 'function') {
    throw new TypeError('createLogger({ hooks: { after } }) must be a function');
  }
  return { before: hooks.before, after: hooks.after };
}

/**
 * Everything shared across a logger and every child/withContext/etc. derived
 * from it lives here: resolved levels, transports, redaction, sampling,
 * hooks, the AsyncLocalStorage instance, and the `once()`/`time()` registries.
 * The Logger instances themselves only hold the bits that legitimately vary
 * per-view: name, level, timestamp toggle, and persistent context.
 */
function buildCore(opts) {
  const levelsTable = resolveLevels(opts.levels);
  const redactor = new Redactor(opts.redact);
  const sampler = new Sampler(validateSamplingOption(opts.sampling));
  const hooks = validateHooks(opts.hooks);

  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const format = resolveFormatOption(opts.format);
  const colorsOption = opts.colors === 'auto' ? undefined : opts.colors;

  const transports = opts.transports
    ? validateTransports(opts.transports)
    : [
        consoleTransport({
          format,
          stdout,
          stderr,
          colors: colorsOption,
          levels: levelsTable.levels,
          labelWidth: levelsTable.labelWidth,
        }),
      ];

  return {
    levels: levelsTable.levels,
    levelOrder: levelsTable.order,
    labelWidth: levelsTable.labelWidth,
    redactor,
    sampler,
    hooks,
    transports,
    als: new AsyncLocalStorage(),
    onceKeys: new Set(),
    timers: new Map(),
    source: Boolean(opts.source),
    redactErrorProps: opts.redactErrorProps !== false,
    stdout,
    stderr,
    format,
    colorsOption,
  };
}

class Logger {
  constructor(options, internalOverrides) {
    if (internalOverrides) {
      this._core = internalOverrides.core;
      this.name = internalOverrides.name;
      this.level = internalOverrides.level;
      this.timestamp = internalOverrides.timestamp;
      this.format = internalOverrides.format;
      this.colorsOption = internalOverrides.colorsOption;
      this._context = internalOverrides.context || null;
    } else {
      const opts = options && typeof options === 'object' ? options : {};
      this._core = buildCore(opts);
      this.name = typeof opts.name === 'string' ? opts.name : '';
      this.level = resolveLevelOption(opts.level, this._core);
      this.timestamp = opts.timestamp !== false;
      this.format = this._core.format;
      this.colorsOption = this._core.colorsOption;
      this._context = null;
    }

    this._attachLevelMethods();
  }

  _attachLevelMethods() {
    for (const levelName of this._core.levelOrder) {
      this[levelName] = (message, meta) => this._log(levelName, message, meta);
    }
  }

  child(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('logger.child(name) requires a non-empty string');
    }

    const childName = this.name ? `${this.name}:${name}` : name;

    return new Logger(null, {
      core: this._core,
      name: childName,
      level: this.level,
      timestamp: this.timestamp,
      format: this.format,
      colorsOption: this.colorsOption,
      context: this._context,
    });
  }

  /**
   * Precedence, lowest to highest specificity: AsyncLocalStorage request
   * context < withContext() persistent context < explicit call-site metadata.
   * A key set in more than one place uses the most specific value.
   */
  withContext(fields) {
    if (!fields || typeof fields !== 'object') {
      throw new TypeError('logger.withContext(fields) requires a plain object');
    }

    return new Logger(null, {
      core: this._core,
      name: this.name,
      level: this.level,
      timestamp: this.timestamp,
      format: this.format,
      colorsOption: this.colorsOption,
      context: Object.assign({}, this._context, fields),
    });
  }

  runWithContext(fields, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('logger.runWithContext(fields, fn) requires a function');
    }
    const current = this._core.als.getStore();
    const merged = Object.assign({}, current, fields);
    return this._core.als.run(merged, fn);
  }

  requestContext(options) {
    return createRequestContextMiddleware(this, options);
  }

  middleware(options) {
    return createRequestLoggingMiddleware(this, options);
  }

  time(label, level = 'info') {
    if (typeof this[level] !== 'function') {
      throw new TypeError(`logger.time(label, level) — "${level}" is not a known level`);
    }
    const timer = createTimer(this, label, level);
    this._core.timers.set(label, timer);
    return timer;
  }

  timeEnd(label, message, meta) {
    const timer = this._core.timers.get(label);
    if (!timer) return;
    this._core.timers.delete(label);
    timer.end(message, meta);
  }

  /**
   * `once()` state lives on the shared core, so it's deduped across the
   * whole tree of loggers derived from the same createLogger() call (a
   * logger and all its .child()/.withContext() descendants) — not reset per
   * child, and not shared between independent createLogger() calls.
   */
  once(key, message, meta) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('logger.once(key, message, meta?) requires a non-empty string key');
    }
    if (this._core.onceKeys.has(key)) return;
    this._core.onceKeys.add(key);
    this._log('warn', message, meta);
  }

  resetOnce(key) {
    if (key === undefined) {
      this._core.onceKeys.clear();
    } else {
      this._core.onceKeys.delete(key);
    }
  }

  flush() {
    for (const transport of this._core.transports) {
      if (typeof transport.flush === 'function') transport.flush();
    }
  }

  close() {
    for (const transport of this._core.transports) {
      if (typeof transport.close === 'function') transport.close();
    }
  }

  _log(level, message, meta) {
    const core = this._core;
    if (!isValidLevel(core.levels, level) || !shouldLog(core.levels, this.level, level)) return;
    if (!core.sampler.allows(level)) return;

    const alsStore = core.als.getStore();
    const rawContext = alsStore || this._context ? Object.assign({}, alsStore, this._context) : null;
    const { meta: rawMetadata, error } = normalizeMeta(meta);

    const redactor = core.redactor;
    const context = rawContext && redactor.enabled ? redactor.redact(rawContext) : rawContext;
    const metadata = rawMetadata && redactor.enabled ? redactor.redact(rawMetadata) : rawMetadata;

    const errorInfo = error
      ? serializeError(error, { redactor, redactErrorProps: core.redactErrorProps })
      : null;

    const source = core.source ? captureSource() : null;

    let entry = {
      timestamp: this.timestamp ? new Date() : null,
      level,
      message: message === undefined ? '' : message,
      name: this.name || undefined,
      context,
      metadata,
      error: errorInfo,
      source,
    };

    if (core.hooks.before) {
      let result;
      try {
        result = core.hooks.before(entry);
      } catch (err) {
        warnOnce('hook:before', `"before" hook threw and was ignored: ${err && err.message}`);
        result = entry;
      }
      if (result === false) return;
      if (result && typeof result === 'object') entry = result;
    }

    for (const transport of core.transports) {
      try {
        transport.log(entry);
      } catch (err) {
        warnOnce('transport', `a transport threw and was ignored: ${err && err.message}`);
      }
    }

    if (core.hooks.after) {
      try {
        core.hooks.after(entry);
      } catch (err) {
        warnOnce('hook:after', `"after" hook threw and was ignored: ${err && err.message}`);
      }
    }
  }
}

module.exports = { Logger };
