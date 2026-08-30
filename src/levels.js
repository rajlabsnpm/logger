'use strict';

const DEFAULT_LEVELS = {
  debug: { value: 10, label: 'DEBUG', color: 'gray' },
  info: { value: 20, label: 'INFO', color: 'cyan' },
  success: { value: 25, label: 'SUCCESS', color: 'green' },
  warn: { value: 30, label: 'WARN', color: 'yellow' },
  error: { value: 40, label: 'ERROR', color: 'red' },
  fatal: { value: 50, label: 'FATAL', color: 'bgRed' },
};

// Anything the Logger prototype already needs for its own methods. A custom
// level called "child" would silently shadow logger.child() and nobody would
// notice until something broke in a confusing way, so we just refuse it.
const RESERVED_METHOD_NAMES = new Set([
  'child',
  'time',
  'timeEnd',
  'withContext',
  'runWithContext',
  'once',
  'middleware',
  'requestContext',
  'flush',
  'close',
  'name',
  'level',
  'constructor',
]);

function buildLevelTable(levels) {
  const order = Object.keys(levels).sort((a, b) => levels[a].value - levels[b].value);
  const labelWidth = Math.max(...order.map((name) => levels[name].label.length));
  return { levels, order, labelWidth };
}

const DEFAULT_TABLE = buildLevelTable(DEFAULT_LEVELS);

function normalizeLevelDef(name, def) {
  if (typeof def === 'number') {
    if (!Number.isFinite(def)) {
      throw new TypeError(`Invalid level definition for "${name}": value must be a finite number`);
    }
    return { value: def, label: name.toUpperCase(), color: 'white' };
  }

  if (def && typeof def === 'object' && typeof def.value === 'number') {
    return {
      value: def.value,
      label: typeof def.label === 'string' ? def.label : name.toUpperCase(),
      color: typeof def.color === 'string' ? def.color : 'white',
    };
  }

  throw new TypeError(
    `Invalid level definition for "${name}": expected a number or { value, label?, color? }`
  );
}

/**
 * Merges user-supplied level definitions on top of the built-ins. Custom
 * levels are additive by default (defining `trace` doesn't remove `debug`),
 * but a name that collides with a built-in level overrides it entirely.
 */
function resolveLevels(customLevels) {
  if (customLevels === undefined || customLevels === null) {
    return DEFAULT_TABLE;
  }

  if (typeof customLevels !== 'object' || Array.isArray(customLevels)) {
    throw new TypeError('createLogger({ levels }) must be a plain object of level definitions');
  }

  const merged = { ...DEFAULT_LEVELS };

  for (const [name, def] of Object.entries(customLevels)) {
    if (RESERVED_METHOD_NAMES.has(name)) {
      throw new TypeError(`"${name}" is a reserved logger method name and cannot be used as a level`);
    }
    merged[name] = normalizeLevelDef(name, def);
  }

  const seenValues = new Map();
  for (const [name, def] of Object.entries(merged)) {
    if (seenValues.has(def.value)) {
      throw new TypeError(
        `Level "${name}" and "${seenValues.get(def.value)}" both have value ${def.value} — level values must be unique`
      );
    }
    seenValues.set(def.value, name);
  }

  return buildLevelTable(merged);
}

function isValidLevel(levels, level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(levels, level);
}

function shouldLog(levels, currentLevel, messageLevel) {
  return levels[messageLevel].value >= levels[currentLevel].value;
}

module.exports = {
  LEVELS: DEFAULT_LEVELS,
  LEVEL_ORDER: DEFAULT_TABLE.order,
  DEFAULT_LEVELS,
  RESERVED_METHOD_NAMES,
  resolveLevels,
  isValidLevel,
  shouldLog,
};
