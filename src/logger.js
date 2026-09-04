'use strict';

const { resolveLevels, isValidLevel, shouldLog } = require('./levels');
const { Redactor } = require('./redact');
const { Sampler, validateSamplingOption } = require('./sampling');
const { serializeError } = require('./errors');
const { captureSource } = require('./source');
const { createTimer } = require('./timer');
const { consoleTransport, validateTransports } = require('./transports');
const { resolveAutoLevel, resolveAutoFormat } = require('./env');
const { resolveVersion, resolveDeployment } = require('./metadata');
const { Collapser } = require('./collapse');
const {
  AsyncLocalStorage,
  createRequestContextMiddleware,
  createRequestLoggingMiddleware,
} = require('./context');

const warnedOnce = new Set();

// Too many timers? Someone forgot to stop the stopwatch.
const TIMER_REGISTRY_WARN_THRESHOLD = 10000;

function warnOnce(key, message) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  try {
    process.stderr.write(`[@rajlabs/logger] ${message}\n`);
  } catch (err) {
    // stderr is already dead. no point yelling into the void.
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

// The new redaction option wins; the old one gets a polite warning.
function resolveRedactErrorProps(opts, redactor) {
  const hasOld = Object.prototype.hasOwnProperty.call(opts, 'redactErrorProps');
  const newValue = redactor.errorPropsOption;

  if (hasOld) {
    warnOnce(
      'redactErrorProps',
      'createLogger({ redactErrorProps }) is deprecated and will be removed in a future major ' +
        'version. Use createLogger({ redact: { errorProps: false } }) instead — same behavior, ' +
        'one config surface. See CHANGELOG.md for the full migration note.'
    );
  }

  if (newValue !== undefined) return newValue;
  if (hasOld) return opts.redactErrorProps !== false;
  return true;
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
 * Shared logger stuff lives here: levels, transports, redaction, sampling,
 * hooks, request context, and the weird timer/once registries.
 * The logger instance itself only keeps the bits that actually change per logger.
 */
function buildCore(opts) {
  const levelsTable = resolveLevels(opts.levels);
  const redactor = new Redactor(opts.redact);
  const sampler = new Sampler(validateSamplingOption(opts.sampling));
  const hooks = validateHooks(opts.hooks);
  const collapser = new Collapser(opts.collapse);

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
    collapser,
    transports,
    als: new AsyncLocalStorage(),
    onceKeys: new Set(),
    timers: new Map(),
    source: Boolean(opts.source),
    redactErrorProps: resolveRedactErrorProps(opts, redactor),
    version: resolveVersion(opts.version),
    deployment: resolveDeployment(opts.deployment),
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

  /**
   * This is the fast path for the logger methods. We already know the level came
   * from our own list, so we skip the slow validity check when the message is being
   * filtered out. The real safety check still lives in `_log()` for the weird cases.
   */
  _attachLevelMethods() {
    const core = this._core;
    for (const levelName of core.levelOrder) {
      const levelDef = core.levels[levelName];
      this[levelName] = (message, meta) => {
        if (levelDef.value < core.levels[this.level].value) return;
        return this._log(levelName, message, meta);
      };
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
   * Context priority is: request-scoped < withContext() < actual call metadata.
   * If the same key shows up in more than one place, the most specific one wins.
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

  /**
   * The timer registry is keyed by label, which is a little cursed.
   * If two timers share the same label, the newer one wins, so we only delete
   * the timer if it is still the exact same instance. Otherwise we would nuke
   * someone else's stopwatch and cause a tiny apocalypse.
   */
  time(label, level = 'info') {
    if (typeof this[level] !== 'function') {
      throw new TypeError(`logger.time(label, level) — "${level}" is not a known level`);
    }
    const core = this._core;
    const timer = createTimer(this, label, level, () => {
      if (core.timers.get(label) === timer) {
        core.timers.delete(label);
      }
    });
    core.timers.set(label, timer);

    // Warn, but do not meddle with somebody else's stopwatch.
    if (core.timers.size >= TIMER_REGISTRY_WARN_THRESHOLD) {
      warnOnce(
        'timer-registry-size',
        `the timer registry has grown to ${core.timers.size} entries. This usually means ` +
          'labels aren\'t being reused (e.g. built from a per-request ID) and their timers ' +
          'are never ended. Make sure every logger.time(label) has a matching timer.end() or ' +
          'logger.timeEnd(label), or use a small, static set of labels.'
      );
    }

    return timer;
  }

  timeEnd(label, message, meta) {
    const timer = this._core.timers.get(label);
    if (!timer) return;
    this._core.timers.delete(label);
    timer.end(message, meta);
  }

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
    this._core.collapser.flushAll();
    for (const transport of this._core.transports) {
      if (typeof transport.flush === 'function') transport.flush();
    }
  }

  close() {
    // Empty the duplicate bucket before closing the shop.
    this._core.collapser.close();
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

    if (core.collapser.enabled) {
      const suppressed = core.collapser.record(
        { level, name: this.name, message, context: rawContext, meta: rawMetadata, error },
        (dLevel, dMessage, dContext, dMeta, dError, collapsed) =>
          this._dispatchEntry(dLevel, dMessage, dContext, dMeta, dError, collapsed)
      );
      if (suppressed) return;
    }

    this._dispatchEntry(level, message, rawContext, rawMetadata, error, null);
  }

  _dispatchEntry(level, message, rawContext, rawMetadata, error, collapsed) {
    const core = this._core;
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
      version: core.version,
      deployment: core.deployment,
      collapsed: collapsed || undefined,
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
