'use strict';

/**
 * This is the little cleanup hook for timers. We only remove our own timer instance,
 * not every timer with the same label, because that would be a very cursed bug.
 */
function createTimer(logger, label, level, onEnd) {
  const start = process.hrtime.bigint();
  let ended = false;

  return {
    end(message, meta) {
      // Calling .end() twice is just a no-op. This happens in finally blocks a bunch,
      // and crashing there is worse than quietly ignoring the second call.
      if (ended) return;
      ended = true;

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const duration = Math.round(durationMs * 100) / 100;

      try {
        logger[level](message || `${label} completed`, Object.assign({ duration }, meta));
      } finally {
        // Clean up even if logging itself explodes. Otherwise the timer stays stuck in the map forever.
        if (typeof onEnd === 'function') onEnd();
      }
    },
  };
}

module.exports = { createTimer };
