'use strict';

const path = require('node:path');

const SRC_DIR = __dirname;

function parseFrame(line) {
  const match = line.match(/\(([^()]+):(\d+):\d+\)\s*$/) || line.match(/at\s+([^()]+):(\d+):\d+\s*$/);
  if (!match) return null;
  return { filePath: match[1], lineNo: match[2] };
}

/**
 * Stack inspection is intentionally opt-in (see the `source` option) because
 * building and parsing a stack trace on every log call is real overhead.
 * We walk frames until we find one that isn't inside this package, so this
 * keeps working no matter how many internal wrapper functions sit between
 * the public log method and this call.
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
