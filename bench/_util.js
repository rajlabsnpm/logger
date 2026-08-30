'use strict';

const { createLogger } = require('../src/index.js');

// A stream that discards everything — benchmarks measure the logger's own
// overhead, not how fast the terminal or filesystem can absorb output.
function nullStream() {
  return {
    isTTY: false,
    write() {
      return true;
    },
  };
}

function bench(name, iterations, fn) {
  // warm up the JIT before taking a real measurement
  for (let i = 0; i < Math.min(1000, iterations); i++) fn(i);

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn(i);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  const opsPerSec = Math.round(iterations / (elapsedMs / 1000));
  console.log(
    `${name.padEnd(38)} ${iterations.toLocaleString().padStart(9)} iters  ` +
      `${elapsedMs.toFixed(1).padStart(9)} ms  ${opsPerSec.toLocaleString().padStart(12)} ops/sec`
  );
}

function loggerWith(options) {
  return createLogger(Object.assign({ stdout: nullStream(), stderr: nullStream() }, options));
}

module.exports = { bench, loggerWith, nullStream };
