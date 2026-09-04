'use strict';

const path = require('node:path');

// Read the app's package.json, not ours. Missing or broken? Skip it.
function resolvePackageVersion(cwd) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const pkg = require(path.join(cwd || process.cwd(), 'package.json'));
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : undefined;
  } catch (err) {
    return undefined;
  }
}

// A string wins, false disables, everything else auto-detects.
function resolveVersion(option, cwd) {
  if (option === false) return undefined;
  if (typeof option === 'string' && option.length > 0) return option;
  return resolvePackageVersion(cwd);
}

// Deployment is opt-in; platforms disagree too much to guess.
function resolveDeployment(option) {
  return typeof option === 'string' && option.length > 0 ? option : undefined;
}

module.exports = { resolvePackageVersion, resolveVersion, resolveDeployment };
