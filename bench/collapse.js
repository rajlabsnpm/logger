'use strict';

const { bench, loggerWith } = require('./_util');

const N = 500_000;

// Baseline: collapse is off.
const disabled = loggerWith({ format: 'json' });
bench('collapse disabled (baseline)', N, () => disabled.warn('Retry failed'));

// Worst case: everything is unique.
const neverCollapses = loggerWith({ format: 'json', collapse: { windowMs: 5000, maxTracked: 100_000 } });
bench('collapse enabled, no duplicates (worst case)', N, (i) =>
  neverCollapses.warn(`unique message ${i}`)
);

// Best case: one line, many repeats.
const flooding = loggerWith({ format: 'json', collapse: { windowMs: 60_000 } });
bench('collapse enabled, identical flood (best case)', N, () => flooding.warn('Retry failed'));

// A realistic mix: repeats with some one-offs.
const mixed = loggerWith({ format: 'json', collapse: { windowMs: 60_000, maxTracked: 1000 } });
bench('collapse enabled, realistic mix (20 hot + long tail)', N, (i) =>
  mixed.warn(i % 100 < 80 ? `hot error ${i % 20}` : `rare one-off event ${i}`)
);
