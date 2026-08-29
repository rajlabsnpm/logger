# @rajlabs/logger

A beautiful, lightweight, **dependency-free** logger for Node.js with clean terminal output, structured metadata, JSON mode, and child loggers — designed for great developer experience out of the box.

```text
22:41:03  INFO     Server started
22:41:03  SUCCESS  Database connected
22:41:03  WARN     Using development configuration
22:41:03  ERROR    Something went wrong
22:41:03  DEBUG    Debug information
```

## Why this package exists

Most Node.js projects end up choosing between `console.log` (no structure, no levels, no color control) and a heavyweight logging framework with a large dependency tree and a steep configuration surface. `@rajlabs/logger` aims for the middle ground: a small, zero-dependency library that gives you readable, colorized terminal output during development and clean, structured JSON output in production — without a build step, without configuration files, and without surprises.

## Installation

```bash
npm install @rajlabs/logger
```

## Quick start

```js
const { createLogger } = require("@rajlabs/logger");

const log = createLogger();

log.info("Server started");
log.success("Database connected");
log.warn("Using development configuration");
log.error("Something went wrong");
log.debug("Debug information");
```

ESM works too:

```js
import { createLogger } from "@rajlabs/logger";
```

## Configuration

`createLogger(options)` accepts:

| Option      | Type                                              | Default     | Description                                              |
| ----------- | -------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `name`      | `string`                                          | `""`        | Namespace shown next to each message, e.g. `[API]`.       |
| `level`     | `"debug" \| "info" \| "success" \| "warn" \| "error"` | `"debug"`   | Minimum level that will be emitted.                        |
| `timestamp` | `boolean`                                         | `true`      | Whether to include a timestamp on each line.               |
| `colors`    | `boolean`                                         | *(auto)*    | Force colors on/off. By default, colors are used only when writing to a real terminal (TTY). |
| `format`    | `"pretty" \| "json"`                              | `"pretty"`  | Output format.                                              |

An invalid `level` or `format` value never throws — it silently falls back to the default so a bad config value can't crash your app.

```js
const log = createLogger({
  name: "API",
  level: "debug",
  timestamp: true,
  colors: true,
  format: "pretty",
});
```

Colors also respect the [`NO_COLOR`](https://no-color.org/) and `FORCE_COLOR` environment variables.

## Logging levels

From least to most severe: `debug`, `info`, `success`, `warn`, `error`. Setting `level` filters out anything less severe than the configured level:

```js
const log = createLogger({ level: "info" });

log.debug("this is hidden");
log.info("this is shown");
```

`debug` and `info` and `success` are written to `stdout`; `warn` and `error` are written to `stderr`, matching standard Unix conventions.

## Metadata

Pass a plain object as the second argument to attach structured data. In pretty mode it's rendered as `key=value` pairs; nested objects and arrays are formatted safely (including circular references, which are shown as `[Circular]` rather than crashing the process):

```js
log.info("Server started", {
  port: 3000,
  environment: "production",
});
```

```text
22:41:03  INFO     Server started  port=3000 environment=production
```

## Error logging

Pass a JavaScript `Error` (or subclass) as the second argument and the logger will render its message and stack trace underneath the log line:

```js
try {
  await db.connect();
} catch (error) {
  log.error("Database connection failed", error);
}
```

```text
22:41:05  ERROR    Database connection failed
  Error: connect ECONNREFUSED 127.0.0.1:5432
      at ...
```

In JSON mode, the error is serialized as a nested `error` object with `name`, `message`, and `stack` fields.

## Child loggers

Create a namespaced child logger that inherits its parent's configuration:

```js
const log = createLogger({ name: "API" });
const dbLog = log.child("Database");

dbLog.info("Connected");
```

```text
22:41:03  INFO     [API:Database] Connected
```

Namespaces are joined with `:`, and child loggers can be nested as deeply as you like.

## JSON mode

For production log aggregation, switch to structured JSON output — one JSON object per line:

```js
const log = createLogger({ format: "json" });

log.info("Server started", { port: 3000 });
```

```json
{
  "timestamp": "2026-08-30T22:41:03.000Z",
  "level": "info",
  "message": "Server started",
  "port": 3000
}
```

Metadata keys are merged onto the top-level object. If a metadata key would collide with a reserved field (`timestamp`, `level`, `message`, `name`, `error`), it is automatically namespaced as `meta_<key>` so it can never silently overwrite a core field.

## API reference

### `createLogger(options?)`

Creates a new logger. See [Configuration](#configuration) for available options.

### `log.debug(message, meta?)` / `log.info(...)` / `log.success(...)` / `log.warn(...)` / `log.error(...)`

Logs a message at the given level. `message` can be any value (it's safely stringified). `meta` may be a plain object, an array, or an `Error` instance.

### `log.child(name)`

Returns a new logger that inherits the parent's configuration and appends `name` to the namespace.

## Examples

**Disabling timestamps:**

```js
const log = createLogger({ timestamp: false });
log.info("no timestamp here");
```

**Disabling colors (e.g. for log files):**

```js
const log = createLogger({ colors: false });
```

**Logging objects and arrays:**

```js
log.info("User created", {
  id: 123,
  name: "Raj",
  active: true,
  roles: ["admin", "user"],
});
```

## Node.js compatibility

Requires Node.js `>= 18.0.0`. Ships as CommonJS with a thin ESM wrapper — no build step, no transpilation, no bundler required.

## License

[MIT](./LICENSE)
