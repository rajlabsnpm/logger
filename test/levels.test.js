'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVELS, LEVEL_ORDER, resolveLevels, isValidLevel, shouldLog } = require('../src/levels');

test('LEVEL_ORDER lists all six built-in levels from least to most severe', () => {
  assert.deepEqual(LEVEL_ORDER, ['debug', 'info', 'success', 'warn', 'error', 'fatal']);
});

test('fatal is the most severe built-in level', () => {
  assert.ok(LEVELS.fatal.value > LEVELS.error.value);
});

test('isValidLevel recognizes known level names against a resolved table', () => {
  const { levels } = resolveLevels();
  assert.equal(isValidLevel(levels, 'info'), true);
  assert.equal(isValidLevel(levels, 'fatal'), true);
  assert.equal(isValidLevel(levels, 'nonsense'), false);
  assert.equal(isValidLevel(levels, undefined), false);
});

test('shouldLog compares severity correctly, including fatal', () => {
  const { levels } = resolveLevels();
  assert.equal(shouldLog(levels, 'info', 'error'), true);
  assert.equal(shouldLog(levels, 'error', 'info'), false);
  assert.equal(shouldLog(levels, 'error', 'fatal'), true);
  assert.equal(shouldLog(levels, 'debug', 'debug'), true);
});

test('resolveLevels() with no argument returns the default table', () => {
  const table = resolveLevels();
  assert.deepEqual(table.order, LEVEL_ORDER);
  assert.equal(table.labelWidth, Math.max(...LEVEL_ORDER.map((n) => LEVELS[n].label.length)));
});

test('custom levels are additive: built-ins survive alongside a new level', () => {
  const table = resolveLevels({ trace: 5 });
  assert.equal(table.levels.trace.value, 5);
  assert.equal(table.levels.debug.value, 10);
  assert.deepEqual(table.order[0], 'trace');
});

test('a numeric custom level definition gets an uppercase label and white color', () => {
  const table = resolveLevels({ trace: 5 });
  assert.equal(table.levels.trace.label, 'TRACE');
  assert.equal(table.levels.trace.color, 'white');
});

test('an object-form custom level definition can override label and color', () => {
  const table = resolveLevels({ trace: { value: 5, label: 'TRC', color: 'magenta' } });
  assert.equal(table.levels.trace.label, 'TRC');
  assert.equal(table.levels.trace.color, 'magenta');
});

test('redefining a built-in level name overrides it entirely', () => {
  const table = resolveLevels({ debug: { value: 1, label: 'DBG', color: 'white' } });
  assert.equal(table.levels.debug.value, 1);
  assert.equal(table.levels.debug.label, 'DBG');
});

test('a custom level colliding with a reserved logger method name throws', () => {
  assert.throws(() => resolveLevels({ child: 5 }), TypeError);
  assert.throws(() => resolveLevels({ withContext: 5 }), TypeError);
});

test('two levels sharing the same numeric value throws', () => {
  assert.throws(() => resolveLevels({ trace: 20 }), TypeError); // collides with built-in "info"
});

test('an invalid level definition shape throws', () => {
  assert.throws(() => resolveLevels({ trace: 'not-a-number' }), TypeError);
  assert.throws(() => resolveLevels({ trace: null }), TypeError);
});

test('a non-object levels option throws', () => {
  assert.throws(() => resolveLevels('nope'), TypeError);
  assert.throws(() => resolveLevels(['nope']), TypeError);
});
