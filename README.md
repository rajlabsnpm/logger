# @rajlabs/logger

A developer-first Node.js logger: beautiful local output, structured production JSON, automatic request context, safe redaction, extensible transports — and a dependency-free core.

```text
22:41:03  INFO     Server started
22:41:03  SUCCESS  Database connected
22:41:03  WARN     Using development configuration
22:41:03  ERROR    Something went wrong
22:41:03  FATAL    Application cannot continue
```

## Why @rajlabs/logger?

Most Node.js projects end up choosing between `console.log` (no structure, no levels, no request correlation) and a heavyweight logging framework with a large dependency tree and a steep configuration surface. `@rajlabs/logger` aims for the middle ground: a small, zero-dependency library that looks great in your terminal during development, produces clean structured JSON in production, and grows with you — automatic request context, redaction, custom transports — without ever requiring a build step or a config file.

- **Zero runtime dependencies**, works as both CommonJS and ESM, no build step.
- **Readable, colorized output in development**, clean structured JSON in production — `"auto"` config picks the right mode for you.
- **Request correlation out of the box.** Cryptographic request IDs and `AsyncLocalStorage`-based ambient context that survives `await`, timers, and nested async calls.
- **Redaction built in**, covering bare keys, dotted paths, and a single-segment wildcard, applied recursively across metadata, context, and Errors.
- **Safe Error serialization** — messages, stacks, `cause` chains, and custom own properties, with sensitive Error properties scrubbed by default.
- **Timers, transports, and hooks** for measuring durations, shipping logs anywhere, and mutating or cancelling entries before they're written.
- **Custom levels and deterministic sampling** for high-volume logs, plus opt-in source locations when you need them.
- **Fast on the common path.** Level filtering happens before any redaction, cloning, or formatting, so disabled log calls stay cheap.
- **Never crashes your app.** Caller data is never mutated, circular references are handled safely, and hook/transport failures are isolated from your process.

## Installation

```bash
npm install @rajlabs/logger
```

## Quick start

```js
const { createLogger } = require("@rajlabs/logger");

const log = createLogger();

log.debug("Debug information");
log.info("Server started");
log.success("Database connected");
log.warn("Using development configuration");
log.error("Something went wrong", new Error("example error"));
log.fatal("Application cannot continue");
```

ESM works too:

```js
import { createLogger } from "@rajlabs/logger";

const log = createLogger();

log.info("Server started");
```

## Configuration

`createLogger(options)` accepts:

| Option              | Type                                                        | Default        | Description                                                                                          |
| ------------------- | ------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `name`              | `string`                                                    | `""`           | Namespace shown next to each message, e.g. `[API]`.                                                  |
| `level`             | level name \| `"auto"`                                        | `"debug"`      | Minimum level emitted. See [Logging levels](#logging-levels) and [Environment-aware config](#environment-aware-config). |
| `levels`            | `object`                                                    | built-ins      | Custom/additional levels. See [Custom levels](#custom-levels).                                        |
| `timestamp`         | `boolean`                                                   | `true`         | Whether to include a timestamp on each line.                                                          |
| `colors`            | `boolean \| "auto"`                                          | *(auto)*       | Force colors on/off, or resolve automatically from TTY status and env vars.                          |
| `format`            | `"pretty" \| "json" \| "auto"`                                | `"pretty"`     | Output format. See [JSON mode](#json-mode) and [Environment-aware config](#environment-aware-config). |
| `redact`            | `boolean \| string[] \| { paths, replacement }`               | *(off)*        | Redact sensitive fields. See [Redaction](#redaction).                                                 |
| `redactErrorProps`  | `boolean`                                                   | `true`         | Scrub known-sensitive names from a logged Error's custom properties. See [Security](#security).       |
| `sampling`          | `{ [level]: rate }`                                         | *(off)*        | Deterministic per-level sampling. See [Sampling](#sampling).                                          |
| `source`            | `boolean`                                                   | `false`        | Attach a `[file:line]` source location to each entry. See [Source location](#source-location).        |
| `transports`        | `Array<{ log }>`                                            | console output | Custom output destinations. See [Transports](#transports).                                            |
| `hooks`             | `{ before?, after? }`                                       | *(none)*       | Lifecycle hooks. See [Hooks](#hooks).                                                                  |
| `stdout` / `stderr` | writable stream                                             | `process.std*` | Override the underlying streams (mainly for testing).                                                 |

An invalid `level` or `format` string never throws — it falls back to the default, matching v1.0 behavior (see [Configuration validation](#configuration-validation) for exactly which options throw vs. fall back).

```js
const log = createLogger({
  name: "API",
  level: "info",
  timestamp: true,
  colors: true,
  format: "pretty",
});
```

Colors also respect the [`NO_COLOR`](https://no-color.org/) and `FORCE_COLOR` environment variables.

### Environment-aware config

Pass `"auto"` for `level`, `format`, or `colors` and the logger picks a sensible value from the environment — conservatively, so you're never surprised:

```js
const log = createLogger({ level: "auto", format: "auto", colors: "auto" });
```

| Setting  | Production or CI | Real TTY  | Piped / non-interactive |
| -------- | ----------------- | --------- | ------------------------ |
| `level`  | `"info"`          | `"debug"` | `"debug"`                |
| `format` | `"json"`          | `"pretty"`| `"json"`                 |

`colors: "auto"` is equivalent to leaving `colors` unset: colors are enabled only on a real TTY, and always respect `NO_COLOR`/`FORCE_COLOR`. "Production" means `NODE_ENV=production`; "CI" means the `CI` environment variable is set to a truthy value.

## Logging levels

From least to most severe: `debug`, `info`, `success`, `warn`, `error`, `fatal`. Setting `level` filters out anything less severe than the configured level:

```js
const log = createLogger({ level: "error" });

log.warn("this is hidden");
log.error("this is shown");
log.fatal("this is shown too");
```

`debug`, `info`, and `success` are written to `stdout`; `warn`, `error`, and `fatal` are written to `stderr`, matching standard Unix conventions.

## Metadata

Pass a plain object as the second argument to attach structured data. In pretty mode it's rendered as `key=value` pairs; nested objects and arrays are formatted safely (including circular references):

```js
log.info("Server started", { port: 3000, environment: "production" });
```

```text
22:41:03  INFO     Server started  port=3000 environment=production
```

## Errors

Pass a JavaScript `Error` (or subclass) as the second argument and the logger renders its message and stack trace underneath the log line:

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

**Cause chains** (`new Error(msg, { cause })`) are serialized recursively, and rendered under a "Caused by:" heading in pretty mode:

```js
try {
  await db.connect();
} catch (inner) {
  throw new Error("Query failed", { cause: inner });
}
```

**Custom properties** on an Error (`err.code`, `err.statusCode`, etc.) are preserved under `error.extra` in JSON mode and shown beneath the error details in pretty mode. Because these often come from HTTP client libraries and can carry credentials the developer never consciously logged, they're scrubbed against a built-in sensitive-name list *by default*, independent of your `redact` config — set `redactErrorProps: false` to disable this safety net.

## Child loggers

Create a namespaced child logger that inherits its parent's configuration (including any persistent context from `withContext`):

```js
const log = createLogger({ name: "API" });
const dbLog = log.child("Database");

dbLog.info("Connected");
```

```text
22:41:03  INFO     [API:Database] Connected
```

Namespaces are joined with `:`, and child loggers can be nested as deeply as you like.

## Context

There are two ways to attach ambient fields to every log call: a **persistent logger view** (`withContext`) and **ambient async context** (`runWithContext`, built on `AsyncLocalStorage` — see [AsyncLocalStorage](#asynclocalstorage)).

```js
const requestLog = log.withContext({ requestId: "req_123", userId: 42 });

requestLog.info("Fetching user");
requestLog.info("User found");
```

```text
INFO  Fetching user  requestId=req_123 userId=42
INFO  User found     requestId=req_123 userId=42
```

**Precedence**, lowest to highest specificity: ambient request context (`runWithContext`) < persistent context (`withContext`) < explicit call-site metadata. A field set in more than one place uses the most specific value:

```js
log.withContext({ userId: 1 }).info("Test", { userId: 2 });
// => userId=2 — explicit metadata always wins
```

`withContext()` composes with `child()` in either order, and both work identically in pretty and JSON mode.

## Timers

```js
const timer = log.time("Database query");

await database.query();

timer.end();
```

```text
INFO     Database query completed  duration=143ms
```

- Timing uses `process.hrtime.bigint()` for high-resolution, accurate measurements, and works correctly across `await` and any async gap.
- `timer.end(message, meta)` lets you customize the completion message and attach extra fields.
- Calling `.end()` more than once is a **safe no-op** — only the first call is recorded.
- `duration` is rendered with an `ms` suffix in pretty mode; in JSON mode it stays a plain number (`"duration": 143`).
- If you prefer a `console.time()`-style pairing, `log.time(label)` / `log.timeEnd(label, message?, meta?)` work the same way, keyed by label. `timeEnd()` on a label that was never started is a silent no-op.
- Timers work through child loggers and carry their name/context.

## Redaction

```js
const log = createLogger({
  redact: ["password", "token", "authorization", "apiKey", "secret"],
});

log.info("User login", { username: "raj", password: "super-secret", token: "abc123" });
```

```text
INFO  User login  username=raj password=[REDACTED] token=[REDACTED]
```

Redaction rules come in two flavors:

- **A bare key name** (`"password"`) matches that key **at any depth**, recursively through objects and arrays.
- **A dotted path** (`"user.password"`, `"request.headers.authorization"`) matches only that exact shape. A single `*` segment acts as a one-level wildcard: `"*.password"` matches `password` one level under any key.

There is no deep/glob wildcard (`**`) — this is a deliberate simplicity trade-off; if you need more, redact at a higher level in your own data before logging.

```js
const log = createLogger({
  redact: {
    paths: ["password", "token"],
    replacement: "[HIDDEN]", // default: "[REDACTED]"
  },
});
```

`redact: true` turns on a built-in list of common sensitive names, covering at minimum: `password`, `passwd`, `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `secret`, `apiKey`, `clientSecret`, `privateKey` (also exported as `DEFAULT_REDACT_KEYS`). It is deliberately conservative — it won't catch every possible field name, but it also won't redact something you actually wanted to see.

Redaction:

- Works recursively through plain objects and arrays, in both pretty and JSON mode.
- Never mutates your original object — a fresh copy is built internally.
- Treats `Error`s, `Date`s, `Map`s, and other class instances as opaque leaves rather than reflecting into their internals — this avoids tripping hostile getters or breaking encapsulation. (Errors get their own redaction pass — see [Errors](#errors).)
- Also applies to persistent (`withContext`) and ambient (`runWithContext`) context fields, not just explicit metadata.

## JSON mode

For production log aggregation, switch to structured JSON output — one JSON object per line:

```js
const log = createLogger({ format: "json" });

log.info("Request completed", { method: "GET", path: "/users", status: 200, duration: 42 });
```

```json
{
  "timestamp": "2026-08-30T22:41:03.000Z",
  "level": "info",
  "message": "Request completed",
  "method": "GET",
  "path": "/users",
  "status": 200,
  "duration": 42
}
```

Context and metadata fields are flattened onto the top-level object (metadata wins on key collisions with context, per the precedence rule above). If a field would collide with a reserved envelope key (`timestamp`, `level`, `message`, `name`, `error`), it's automatically namespaced as `meta_<key>` so it can never silently overwrite a core field.

## Request logging

`log.middleware()` gives you automatic per-request logging with method/path/status/duration/request ID, with no framework dependency:

```js
const log = createLogger({ name: "API" });

app.use(log.middleware());
```

```text
GET  /users    200  42ms
POST /login    201  83ms
GET  /reports  500  1842ms
```

Options:

```js
log.middleware({
  enabled: true,              // set false to disable automatic logging (context propagation still runs)
  level: undefined,           // force every request log to a fixed level instead of status-based
  statusLevel: (status) => …, // customize the status -> level mapping
  ignore: ["/health"],        // strings (prefix match), RegExp, or a (req) => boolean function
  fields: (req, res) => ({}), // merge in extra fields
  requestId: { header: "x-request-id", trustHeader: true },
});
```

By default, status codes map to levels as `2xx/3xx → info`, `4xx → warn`, `5xx → error`. Request bodies are **never** read or logged.

`log.middleware()` works with Express (`(req, res, next)`) *and* as a raw `http.createServer` request listener — `next` is only invoked if it was actually provided:

```js
const server = http.createServer((req, res) => {
  requestLogger(req, res, () => handleRequest(req, res));
});
```

If you only want request-ID propagation without automatic request/response logging, use `log.requestContext(options)` — it accepts the same `fields`/`requestId` options.

## AsyncLocalStorage

`log.middleware()` and `log.requestContext()` are built on Node's built-in `AsyncLocalStorage` — no dependency required. You can use it directly for framework-independent context propagation:

```js
const log = createLogger();

log.runWithContext({ requestId: "req_123" }, async () => {
  await doSomething();
  log.info("Inside request"); // automatically includes requestId
});
```

The context survives `await`, promises, timers, nested callbacks, and database calls — anything within the same async execution. Nested `runWithContext` calls merge with the outer context, with the inner context winning on key collisions; the outer context is automatically restored once the nested call returns.

Request IDs are generated with `node:crypto` (`req_<12 hex chars>`). If an incoming request has a valid `X-Request-ID` header, it's reused by default (`requestId: { trustHeader: true }`, the default) — but only if it matches a strict allowlist pattern (`/^[A-Za-z0-9_-]{1,128}$/`). A malformed or suspicious header value is never trusted blindly; a fresh ID is generated instead. Set `trustHeader: false` to always generate a fresh ID, or `header: "x-trace-id"` to read a different header name.

## Express integration

`log.middleware()` is framework-agnostic and works directly as Express middleware:

```js
const express = require("express");
const { createLogger } = require("@rajlabs/logger");

const app = express();
const log = createLogger({ name: "API" });

app.use(log.middleware());
```

Express is never a runtime dependency of this package — `log.middleware()` only relies on the `(req, res, next)` shape that Express (and plain Node `http`) already provide.

## Transports

Internally, every log call builds a structured entry and hands it to one or more **transports**:

```text
Logger → Structured Entry → Redaction/Sampling → Transports (console / JSON / custom)
```

A transport is any object with a `log(entry)` method:

```js
const entries = [];

const customTransport = {
  log(entry) {
    entries.push(entry);
  },
};

const log = createLogger({ transports: [customTransport] });

log.info("User logged in", { userId: 42 });

// entries[0] is the structured entry:
// { timestamp, level: "info", message: "User logged in", name, context, metadata: { userId: 42 }, error, source }
```

Transports can optionally implement `flush()`/`close()` for cleanup on shutdown — called via `logger.flush()` / `logger.close()`.

The built-in console output is itself a transport, exported as `consoleTransport()`, so you can combine it with your own:

```js
const { createLogger, consoleTransport } = require("@rajlabs/logger");

const log = createLogger({
  transports: [
    consoleTransport(), // keep the normal terminal output
    { log(entry) { sendSomewhere(entry); } },
  ],
});
```

Supplying `transports` replaces the default console transport entirely — include `consoleTransport()` explicitly if you still want terminal output alongside your own. A transport that throws is caught and ignored (with a one-time warning to stderr) rather than crashing your app or blocking other transports.

## Hooks

```js
const log = createLogger({
  hooks: {
    before(entry) {
      // can mutate and return the entry, or return false to cancel logging
      return entry;
    },
    after(entry) {
      // called once the entry has been sent to every transport
    },
  },
});
```

- `before` can mutate the entry and must return it (or a replacement) to continue, or return `false` to cancel the log entirely.
- `after` is fire-and-forget — its return value is ignored.
- A hook that throws is caught, a one-time warning is written to stderr, and logging proceeds as if the hook wasn't there — a broken hook never crashes your application.

## Custom levels

```js
const log = createLogger({
  level: "trace",
  levels: {
    trace: 5,
    debug: 10,
    info: 20,
    success: 25,
    warn: 30,
    error: 40,
    fatal: 50,
  },
});

log.trace("Detailed trace");
```

Custom levels are additive on top of the built-ins by default — defining just `{ trace: 5 }` keeps `debug`/`info`/etc. intact. Redefining a built-in name (e.g. `debug`) overrides it entirely. A level definition can be a plain number, or `{ value, label?, color? }` for a custom display label/color.

Validated at `createLogger()` time: level names can't collide with reserved logger methods (`child`, `time`, `once`, etc.), and two levels can't share the same numeric value.

## Sampling

```js
const log = createLogger({ sampling: { debug: 0.1 } });
```

Sampling here is **deterministic**, not randomized: a rate of `0.1` emits exactly the 1st out of every 10 eligible messages, not "roughly" 1 in 10. This makes the volume predictable and the behavior testable, at the cost of not being a true random sample. If you need randomized sampling, implement that policy in a custom transport or upstream.

- Only levels explicitly listed in `sampling` are affected; anything else (including `error`/`fatal` by default) is never sampled.
- Sampling is checked immediately after the level filter, before any redaction, context merging, or formatting happens — sampled-out messages do essentially no work.

## Source location

```js
const log = createLogger({ source: true });
log.info("Server started");
```

```text
INFO  Server started  [src/server.js:42]
```

This is **opt-in only** — capturing and parsing a stack trace on every call is real overhead, so it's never part of the default fast path. It's available in both pretty mode (`[file:line]` tag) and JSON mode (`"source"` field).

## Performance

The normal path is designed to stay fast, especially for disabled levels:

- A filtered-out level call (`log.debug(...)` when `level: "info"`) does no formatting, no redaction, no cloning, and no stack inspection — just a single numeric comparison.
- Sampling is checked right after the level filter, before any other work.
- Redaction is skipped entirely (no allocation, no cloning) when `redact` isn't configured.
- Source-location capture only happens when `source: true` is set.
- Metadata/context objects are only copied when there's actually something to merge (context + metadata); a plain `log.info("msg", data)` with no context passes `data` straight through by reference until formatting.

See [`bench/`](./bench) for the benchmark suite and how to run it.

## Security

- The logger **never sends logs over the network** on its own — that only happens if you configure a transport that does.
- Logging never mutates caller-provided objects, whether or not redaction is configured.
- Redaction never reflects into class instances, `Date`s, `Map`s, etc. — only plain objects and arrays are walked, which avoids triggering hostile/unexpected getters.
- A getter that throws degrades that single field to `"[unreadable]"` instead of crashing the log call or losing the rest of the line.
- Circular references are handled safely in both pretty (native `util.inspect` behavior) and JSON (`"[Circular]"`) modes.
- Custom Error properties are scrubbed against a built-in sensitive-name list by default, independent of your `redact` config (`redactErrorProps: false` to disable).
- Incoming `X-Request-ID` header values are validated against a strict allowlist pattern before being trusted; anything else is discarded in favor of a freshly generated ID.
- Request bodies are never read or logged by `log.middleware()`.

## Configuration validation

- **`level` and `format`** (plain strings) never throw on an invalid value — they fall back to the default, since these often come from environment variables that shouldn't be able to crash your app. This matches v1.0's original contract.
- **Structural configuration you write in code** — `levels`, `redact`, `sampling`, `transports`, `hooks` — throws synchronously at `createLogger()` time on a malformed shape. These are programming errors you want to catch immediately in development, not something that should silently misbehave in production.

## API reference

### `createLogger(options?)`

Creates a new logger. See [Configuration](#configuration).

### `log.debug/info/success/warn/error/fatal(message, meta?)`

Logs at the given level. `message` can be any value (safely stringified). `meta` may be a plain object, an array, or an `Error` instance. Custom levels (see [Custom levels](#custom-levels)) add their own methods the same way.

### `log.child(name)`

Returns a new logger that inherits the parent's configuration (including persistent context) and appends `name` to the namespace.

### `log.withContext(fields)`

Returns a new logger view with `fields` merged into its persistent context. See [Context](#context).

### `log.runWithContext(fields, fn)`

Runs `fn` with `fields` merged into the ambient `AsyncLocalStorage` context for the duration of the call (including across `await`). See [AsyncLocalStorage](#asynclocalstorage).

### `log.middleware(options?)` / `log.requestContext(options?)`

Request logging / context-only middleware. See [Request logging](#request-logging).

### `log.time(label, level?)`

Starts a timer; returns `{ end(message?, meta?) }`. See [Timers](#timers).

### `log.timeEnd(label, message?, meta?)`

Ends a timer started with `log.time(label)`, by label.

### `log.once(key, message, meta?)`

Logs `message` at `warn` level, but only the first time a given `key` is seen:

```js
log.once("deprecated-api", "This API is deprecated");
```

`once()` state is shared across a logger and all of its `.child()`/`.withContext()` descendants, but not across independent `createLogger()` calls. `log.resetOnce(key?)` clears one key, or all keys if called with no argument.

### `log.flush()` / `log.close()`

Calls `flush()`/`close()` on every transport that implements it.

### `consoleTransport(options?)`

The built-in console transport, exported for combining with custom transports. See [Transports](#transports).

### `LEVELS`, `LEVEL_ORDER`

The default level table and its severity order (`["debug", "info", "success", "warn", "error", "fatal"]`).

### `DEFAULT_REDACT_KEYS`

The built-in list of sensitive key names used by `redact: true`.

### `VERSION`

The package version string.

## Examples

See [`examples/`](./examples) for complete, runnable examples:

- [`basic.js`](./examples/basic.js) — the five-minute quick start
- [`json.js`](./examples/json.js) — JSON production output
- [`child-loggers.js`](./examples/child-loggers.js) — namespacing
- [`timers.js`](./examples/timers.js) — timing async operations
- [`context.js`](./examples/context.js) — `withContext` and `runWithContext`
- [`redaction.js`](./examples/redaction.js) — key, path, and wildcard redaction
- [`api-server.js`](./examples/api-server.js) — a real `http` server with automatic request logging
- [`custom-transport.js`](./examples/custom-transport.js) — combining transports and hooks

## Migration from v1.0.0

There are no breaking changes. Every v1.0.0 API and behavior — `createLogger()`, `debug/info/success/warn/error`, `level`, `timestamp`, `colors`, `format`, `name`, `child()`, metadata handling, error handling, `NO_COLOR`/`FORCE_COLOR`, CJS/ESM — continues to work exactly as documented. `fatal` is a new, additive level; everything else described above is opt-in via new configuration options.

## Node.js compatibility

Requires Node.js `>= 18.0.0`. Ships as CommonJS with a thin ESM wrapper — no build step, no transpilation, no bundler required.

## License

[MIT](./LICENSE)