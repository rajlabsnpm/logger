'use strict';

const DEFAULT_WINDOW_MS = 5000;
const DEFAULT_MAX_TRACKED = 1000;

function normalizeCollapseOption(option) {
  if (!option) return null;

  if (option === true) {
    return { windowMs: DEFAULT_WINDOW_MS, maxTracked: DEFAULT_MAX_TRACKED };
  }

  if (typeof option === 'object') {
    const windowMs = option.windowMs === undefined ? DEFAULT_WINDOW_MS : option.windowMs;
    const maxTracked = option.maxTracked === undefined ? DEFAULT_MAX_TRACKED : option.maxTracked;

    if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError('createLogger({ collapse: { windowMs } }) must be a positive number');
    }
    if (typeof maxTracked !== 'number' || !Number.isInteger(maxTracked) || maxTracked <= 0) {
      throw new TypeError('createLogger({ collapse: { maxTracked } }) must be a positive integer');
    }

    return { windowMs, maxTracked };
  }

  throw new TypeError('createLogger({ collapse }) must be `true` or { windowMs, maxTracked }');
}

function safeGet(obj, prop) {
  try {
    return obj[prop];
  } catch (err) {
    return undefined;
  }
}

// Stable beats pretty here. Also: never throw.
function safeKeyPart(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch (err) {
    return '[unkeyable]';
  }
}

/** Same level, logger, message, and error summary. Context stays out. */
function buildKey(level, name, message, error) {
  let errorKey = '';
  if (error) {
    errorKey = `${safeKeyPart(safeGet(error, 'name'))}\u0000${safeKeyPart(safeGet(error, 'message'))}`;
  }
  return `${level}\u0000${name || ''}\u0000${safeKeyPart(message)}\u0000${errorKey}`;
}

/** First one through, repeats wait, then one tiny summary. */
class Collapser {
  constructor(option) {
    const normalized = normalizeCollapseOption(option);
    this.enabled = Boolean(normalized);
    if (!this.enabled) return;

    this.windowMs = normalized.windowMs;
    this.maxTracked = normalized.maxTracked;
    this.states = new Map();
  }

  /** Record a call; return true when it gets folded into an existing run. */
  record(payload, dispatch) {
    if (!this.enabled) return false;

    const key = buildKey(payload.level, payload.name, payload.message, payload.error);
    const existing = this.states.get(key);

    if (existing) {
      existing.count += 1;
      existing.context = payload.context;
      existing.meta = payload.meta;
      existing.error = payload.error;
      existing.dispatch = dispatch;
      return true;
    }

    if (this.states.size >= this.maxTracked) {
      // Full bucket. Let this one through.
      return false;
    }

    const state = {
      level: payload.level,
      name: payload.name,
      message: payload.message,
      count: 0,
      context: null,
      meta: null,
      error: null,
      dispatch,
      timer: null,
    };
    state.timer = setTimeout(() => this._flush(key), this.windowMs);
    if (typeof state.timer.unref === 'function') state.timer.unref();
    this.states.set(key, state);

    return false;
  }

  _flush(key) {
    const state = this.states.get(key);
    if (!state) return;
    this.states.delete(key);

    if (state.count > 0 && typeof state.dispatch === 'function') {
      state.dispatch(state.level, state.message, state.context, state.meta, state.error, {
        count: state.count,
        windowMs: this.windowMs,
      });
    }
  }

  /** Emit any pending summaries right now instead of waiting for their timers. */
  flushAll() {
    if (!this.enabled) return;
    for (const key of Array.from(this.states.keys())) {
      const state = this.states.get(key);
      if (state && state.timer) clearTimeout(state.timer);
      this._flush(key);
    }
  }

  close() {
    this.flushAll();
  }
}

module.exports = { Collapser, normalizeCollapseOption, DEFAULT_WINDOW_MS, DEFAULT_MAX_TRACKED };
