'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVELS, LEVEL_ORDER, isValidLevel, shouldLog } = require('../src/levels');

test('LEVEL_ORDER lists all five levels from least to most severe', () => {
  assert.deepEqual(LEVEL_ORDER, ['debug', 'info', 'success', 'warn', 'error']);
});

test('every level has a numeric value, a label, and a color', () => {
  for (const name of LEVEL_ORDER) {
    assert.equal(typeof LEVELS[name].value, 'number');
    assert.equal(typeof LEVELS[name].label, 'string');
    assert.equal(typeof LEVELS[name].color, 'string');
  }
});

test('isValidLevel recognizes known level names', () => {
  for (const name of LEVEL_ORDER) {
    assert.equal(isValidLevel(name), true);
  }
});

test('isValidLevel rejects unknown or malformed input', () => {
  assert.equal(isValidLevel('verbose'), false);
  assert.equal(isValidLevel(''), false);
  assert.equal(isValidLevel(undefined), false);
  assert.equal(isValidLevel(null), false);
  assert.equal(isValidLevel(42), false);
  assert.equal(isValidLevel({}), false);
});

test('shouldLog compares severity correctly', () => {
  assert.equal(shouldLog('info', 'debug'), false);
  assert.equal(shouldLog('info', 'info'), true);
  assert.equal(shouldLog('info', 'success'), true);
  assert.equal(shouldLog('info', 'warn'), true);
  assert.equal(shouldLog('info', 'error'), true);

  assert.equal(shouldLog('error', 'warn'), false);
  assert.equal(shouldLog('error', 'error'), true);

  assert.equal(shouldLog('debug', 'debug'), true);
});
