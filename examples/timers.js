'use strict';

const { createLogger } = require('../src/index.js');

const log = createLogger({ name: 'API' });

async function fakeQuery(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const timer = log.time('Database query');
  await fakeQuery(120);
  timer.end();

  const namedTimer = log.time('Cache lookup');
  await fakeQuery(15);
  namedTimer.end('Cache lookup finished', { hit: true });

  // console.time()-style pairing
  log.time('Full request');
  await fakeQuery(200);
  log.timeEnd('Full request', 'Request handled');
}

main();
