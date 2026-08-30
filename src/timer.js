'use strict';

function createTimer(logger, label, level) {
  const start = process.hrtime.bigint();
  let ended = false;

  return {
    end(message, meta) {
      // Repeated .end() calls are a no-op rather than an error — timers are
      // often ended from a finally block alongside an early-return path that
      // already ended them, and crashing there would be worse than ignoring it.
      if (ended) return;
      ended = true;

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const duration = Math.round(durationMs * 100) / 100;

      logger[level](message || `${label} completed`, Object.assign({ duration }, meta));
    },
  };
}

module.exports = { createTimer };
