import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjsModule = require('./index.js');

export const createLogger = cjsModule.createLogger;
export const LEVELS = cjsModule.LEVELS;
export const LEVEL_ORDER = cjsModule.LEVEL_ORDER;
export const consoleTransport = cjsModule.consoleTransport;
export const DEFAULT_REDACT_KEYS = cjsModule.DEFAULT_REDACT_KEYS;
export const VERSION = cjsModule.VERSION;

export default cjsModule;
