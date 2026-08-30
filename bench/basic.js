'use strict';

const { bench, loggerWith } = require('./_util');

const N = 1_000_000;

const disabled = loggerWith({ level: 'info' });
bench('disabled debug (level filtered out)', N, () => disabled.debug('this never gets formatted'));

const basic = loggerWith();
bench('basic info (pretty, no metadata)', N, () => basic.info('server started'));

const withName = loggerWith({ name: 'API' });
bench('basic info with a logger name', N, () => withName.info('server started'));

const child = loggerWith({ name: 'API' }).child('DB');
bench('basic info via a child logger', N, () => child.info('query ok'));
