'use strict';

/** Run every benchmark except files starting with "_". */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const benchDir = path.join(__dirname, '..', 'bench');

const files = fs
  .readdirSync(benchDir)
  .filter((name) => name.endsWith('.js') && !name.startsWith('_'))
  .sort();

if (files.length === 0) {
  console.error(`No benchmark files found in ${benchDir}`);
  process.exit(1);
}

for (const file of files) {
  const fullPath = path.join(benchDir, file);

  const result = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit',
  });

  if (result.error) {
    // e.g. the executable couldn't be spawned at all
    console.error(`Failed to run ${file}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}
