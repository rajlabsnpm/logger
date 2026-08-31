'use strict';

const path = require('node:path');

const SRC_DIR = __dirname;

function parseFrame(line) {
  const match = line.match(/\(([^()]+):(\d+):\d+\)\s*$/) || line.match(/at\s+([^()]+):(\d+):\d+\s*$/);
  if (!match) return null;
  return { filePath: match[1], lineNo: match[2] };
}

/**
 * We only do this when the source option is on, because stack parsing is expensive.
 * We walk up until we leave this package so the log points to the real caller,
 * not the logger internals doing the waving.
 */
function captureSource() {
  const originalLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 20;
  const holder = {};
  Error.captureStackTrace(holder, captureSource);
  Error.stackTraceLimit = originalLimit;

  const lines = (holder.stack || '').split('\n');
  for (const line of lines) {
    const frame = parseFrame(line);
    if (!frame) continue;
    if (frame.filePath.startsWith(SRC_DIR)) continue;
    if (frame.filePath.startsWith('node:')) continue;

    const relative = path.isAbsolute(frame.filePath)
      ? path.relative(process.cwd(), frame.filePath)
      : frame.filePath;
    return `${relative}:${frame.lineNo}`;
  }
  return null;
}

module.exports = { captureSource };
