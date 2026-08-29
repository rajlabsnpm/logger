import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjsModule = require('./index.js');

export const createLogger = cjsModule.createLogger;
export const LEVELS = cjsModule.LEVELS;
export const LEVEL_ORDER = cjsModule.LEVEL_ORDER;

export default cjsModule;
