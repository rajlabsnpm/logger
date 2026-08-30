'use strict';

function validateSamplingOption(sampling) {
  if (sampling === undefined || sampling === null) return null;

  if (typeof sampling !== 'object' || Array.isArray(sampling)) {
    throw new TypeError('createLogger({ sampling }) must be an object mapping level -> rate');
  }

  const rates = {};
  for (const [level, rate] of Object.entries(sampling)) {
    if (typeof rate !== 'number' || Number.isNaN(rate) || rate < 0 || rate > 1) {
      throw new TypeError(
        `createLogger({ sampling }) rate for "${level}" must be a number between 0 and 1, got ${rate}`
      );
    }
    rates[level] = rate;
  }
  return rates;
}

/**
 * Sampling here is deterministic (every Nth message), not randomized. A rate
 * of 0.1 emits exactly 1 in 10 eligible messages rather than "roughly" 1 in
 * 10 — which makes the behavior testable and gives you a predictable log
 * volume instead of a random one. Levels not listed in `sampling` are never
 * sampled, so errors/fatals are unaffected unless you explicitly opt them in.
 */
class Sampler {
  constructor(rates) {
    this.rates = rates;
    this.counters = new Map();
  }

  allows(level) {
    if (!this.rates || !Object.prototype.hasOwnProperty.call(this.rates, level)) return true;

    const rate = this.rates[level];
    if (rate >= 1) return true;
    if (rate <= 0) return false;

    const everyN = Math.max(1, Math.round(1 / rate));
    const count = (this.counters.get(level) || 0) + 1;
    this.counters.set(level, count);
    return count % everyN === 1;
  }
}

module.exports = { Sampler, validateSamplingOption };
