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
| `redact`            | `boolean \| string[] \| { paths?, replacement?, errorProps? }` | *(off)*        | Redact sensitive fields. See [Redaction](#redaction).                                                 |
| `redactErrorProps`  | `boolean`                                                   | `true`         | **Deprecated** — use `redact: { errorProps }` instead. See [Redaction](#redaction).                   |
| `sampling`          | `{ [level]: rate }`                                         | *(off)*        | Deterministic per-level sampling. See [Sampling](#sampling).                                          |
| `collapse`          | `boolean \| { windowMs?, maxTracked? }`                       | *(off)*        | Collapse repeated identical log lines. See [Duplicate log collapsing](#duplicate-log-collapsing).     |
| `version`           | `string \| false`                                           | *(auto)*       | Version attached to JSON output. See [Version & deployment metadata](#version--deployment-metadata).  |
| `deployment`        | `string`                                                    | *(none)*       | Deployment identifier attached to JSON output. See [Version & deployment metadata](#version--deployment-metadata). |
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

**Custom properties** on an Error (`err.code`, `err.statusCode`, etc.) are preserved under `error.extra` in JSON mode and shown beneath the error details in pretty mode. Because these often come from HTTP client libraries and can carry credentials the developer never consciously logged, they're scrubbed against a built-in sensitive-name list *by default*, independent of your `redact` config — see [Error property redaction](#error-property-redaction) for how to configure or disable this.

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
- Every timer removes its own bookkeeping entry as soon as it's ended (via either `.end()` or `timeEnd()`), so ending timers never accumulates memory — see the v1.5.1 entry in the [CHANGELOG](./CHANGELOG.md) if you're upgrading from an earlier version. A timer that's started and genuinely never ended is kept around so a later `timeEnd(label)` can still find it; this is bounded by how many distinct, unfinished labels your application creates, not by log volume.
- As a guard against that last case growing unbounded (typically from building labels out of something unique per call, like a request ID, and never ending them), a one-time warning is printed to `stderr` once the registry passes 10,000 simultaneously open entries. It's a warning only — no timer is ever deleted or altered by this check, since silently cleaning up would just replace a memory leak with a silently-wrong duration measurement the next time someone calls `timeEnd()` on a "cleaned up" label.

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
- Stops descending past 20 levels of nesting (objects and arrays combined), replacing anything deeper with `"[Redaction depth limit exceeded]"` instead of continuing to recurse. This is well beyond any nesting depth a real application would deliberately construct, and exists purely as a safety net against pathological or maliciously crafted input.

### Error property redaction

Custom properties on a logged `Error` (`err.config.headers.authorization`, etc.) are scrubbed against `DEFAULT_REDACT_KEYS` **by default**, independent of whether `redact` is configured at all — see [Errors](#errors) for why. Configure this with `errorProps` inside the same `redact` object used for everything else:

```js
const log = createLogger({
  redact: { errorProps: false }, // turn off the built-in error-prop safety net
});

const log2 = createLogger({
  redact: { paths: ["password"], errorProps: false }, // your own rules still apply to error extras
});
```

`redact: { errorProps: false }` on its own (no `paths`) is a normal, zero-overhead way to say "don't touch error extras, and don't touch anything else either" — omitting `paths` doesn't implicitly turn on any context/metadata redaction.

Whatever you put in `redact.paths` (or `redact: true`/`redact: [...]`) always applies to error extras too, regardless of `errorProps` — `errorProps` only controls the *built-in* default-key safety net, not your own rules.

> **Migrating from `redactErrorProps`:** the top-level `redactErrorProps` option is deprecated as of v1.6 in favor of `redact: { errorProps }` — same behavior, one config surface instead of two overlapping ones. It still works during the 1.x line (with a one-time deprecation warning on `stderr`); if both are supplied, `redact.errorProps` wins.
>
> ```diff
> - createLogger({ redactErrorProps: false })
> + createLogger({ redact: { errorProps: false } })
> ```

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
  "pid": 48213,
  "hostname": "web-1",
  "message": "Request completed",
  "method": "GET",
  "path": "/users",
  "status": 200,
  "duration": 42
}
```

`pid` (`process.pid`) and `hostname` (`os.hostname()`) are included on every JSON line, resolved once at process start — this is JSON-mode only and doesn't appear in pretty output.

Context and metadata fields are flattened onto the top-level object (metadata wins on key collisions with context, per the precedence rule above). If a field would collide with a reserved envelope key (`timestamp`, `level`, `pid`, `hostname`, `version`, `deployment`, `message`, `name`, `error`), it's automatically namespaced as `meta_<key>` so it can never silently overwrite a core field.

## Version & deployment metadata

```js
const log = createLogger(); // version auto-detected from your package.json
```

```json
{ "level": "info", "pid": 48213, "hostname": "web-1", "version": "2.3.1", "message": "Server started" }
```

`version` is auto-detected once, at `createLogger()` time, from the *consuming application's* `package.json` (`process.cwd()` — this doesn't walk up the directory tree looking for one, so run your app from its package root as usual). Override or disable it explicitly:

```js
createLogger({ version: "2.3.1" }); // explicit override, skips auto-detection
createLogger({ version: false }); // no version field at all
```

There's no equivalent auto-detection for `deployment` (a git SHA, a release tag, whatever your pipeline uses) — different hosting platforms expose this under different, incompatible env var names, so it's explicit-only:

```js
createLogger({ deployment: process.env.GIT_SHA });
```

Both are JSON-mode only, following the same convention as `pid`/`hostname` — pretty-mode output doesn't show either, to keep local dev output uncluttered.

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

## Duplicate log collapsing

An opt-in guard against a retry loop or a flapping dependency flooding your output with the same line over and over:

```js
const log = createLogger({ collapse: true }); // windowMs: 5000, maxTracked: 1000

for (let i = 0; i < 100; i++) {
  log.warn("Retry failed");
}
```

```text
22:41:05  WARN     Retry failed
22:41:10  WARN     Retry failed  (+99 more in 5.0s)
```

The first occurrence of a message is always logged immediately, in full — nothing is ever delayed or hidden on the first call. If more calls come in that count as "the same" before the window closes, they're counted instead of logged; once `windowMs` elapses with no further matches (or you call `log.flush()`/`log.close()`), one summary line is emitted with the count and the metadata/error from the *most recent* suppressed call. The next matching call after that starts a fresh cycle.

Two calls count as duplicates when they share the same **level**, **logger name**, **message text**, and — if an error is attached — the same **error name + message**. Metadata and context are deliberately *not* part of that comparison: they usually carry the one thing that's actually varying across an otherwise-repeated call (an attempt number, a request ID), and folding them into the comparison would mean near-identical floods almost never actually collapse. The trade-off is that the *specific* metadata on each suppressed call is not individually preserved — only the most recent one survives, alongside the count.

```json
{"level":"warn","message":"Retry failed","attempt":1}
{"level":"warn","message":"Retry failed","attempt":100,"collapsed":{"count":99,"windowMs":5000}}
```

The `message` field is never altered by collapsing (no `" x99"` appended to it), so grouping or alerting on exact message text in a log aggregator still works on both the full entry and the summary.

Configure the window and the memory bound explicitly:

```js
const log = createLogger({
  collapse: { windowMs: 10_000, maxTracked: 500 },
});
```

- **`windowMs`** (default `5000`): how long a run of duplicates is tracked before a summary is emitted.
- **`maxTracked`** (default `1000`): the maximum number of *distinct* messages tracked at once. Once full, a genuinely new distinct message is simply logged normally (uncollapsed) rather than evicting an in-progress window or being dropped — nothing your application logs is ever silently discarded by this feature.
- A message that never actually repeats produces no summary line, ever, and costs one internal entry plus one timer for at most `windowMs`.
- Timers used for this are unref'd — an idle logger with pending collapse windows will never keep your process alive.
- **Hooks and transports only see the first occurrence and the periodic summary**, not every individual suppressed call — the same trade-off `sampling` already makes for sampled-out messages.
- Disabled by default; the disabled path costs a single boolean check per call.

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

- A filtered-out level call (`log.debug(...)` when `level: "info"`) does no formatting, no redaction, no cloning, and no stack inspection — just a single numeric comparison against the current level threshold. (Before v1.5.1, this path also re-validated the level name on every call; that check was redundant — the level name reaching it was always already known-valid — and has been removed. See the [CHANGELOG](./CHANGELOG.md).)
- Sampling is checked right after the level filter, before any other work.
- Redaction is skipped entirely (no allocation, no cloning) when `redact` isn't configured.
- Source-location capture only happens when `source: true` is set.
- Metadata/context objects are only copied when there's actually something to merge (context + metadata); a plain `log.info("msg", data)` with no context passes `data` straight through by reference until formatting.
- `collapse` and the timer-registry leak guard are both off the hot path when not in use: collapsing costs a single boolean check per call when disabled (the default), and the timer guard is one integer comparison per `log.time()` call, regardless of registry size.
- When `collapse` *is* enabled, a genuine flood of duplicate messages is substantially faster than logging every line (suppressed calls skip redaction, hooks, and transports entirely) — but enabling it for messages that never actually repeat adds real, measurable overhead (mostly the cost of arming a timer) for no benefit. See `bench/collapse.js` for both cases measured side by side; don't take either number on faith.

See [`bench/`](./bench) for the benchmark suite and how to run it.

## Security

"Safe structured logging by default" is the design goal here, not a marketing claim — this section is a precise, testable list of exactly what that covers, with links to the tests backing each item, not an assertion that this is "the most secure" anything.

- The logger **never sends logs over the network** on its own — that only happens if you configure a transport that does.
- Logging never mutates caller-provided objects, whether or not redaction is configured.
- Pretty-mode output sanitizes control characters (newlines, carriage returns, tabs, ANSI/terminal escape sequences) out of the `message`, metadata/context **key names and values**, and error name/message — a value *or key* like `"line one\nFAKE"` renders as the visible text `line one\nFAKE`, not as a forged second log line. Normal printable Unicode is untouched. JSON mode was never affected by this, since `JSON.stringify` already escapes control characters in both keys and values. (Key-name sanitization is new in v1.6 — see the [CHANGELOG](./CHANGELOG.md) if you're upgrading from v1.5.1, which sanitized values but not keys.)
- Redaction never reflects into class instances, `Date`s, `Map`s, etc. — only plain objects and arrays are walked, which avoids triggering hostile/unexpected getters. This includes the internal check used to *tell* a plain object from a class instance in the first place: if reading a value's `constructor` throws, it's treated as an opaque leaf rather than crashing redaction.
- A getter that throws — on a metadata field, an Error's custom property, or one of an Error's own `name` / `message` / `stack` / `cause` properties — degrades just that one field to a safe fallback instead of crashing the log call or losing the rest of the line.
- Circular references are handled safely in both pretty (native `util.inspect` behavior) and JSON (`"[Circular]"`) modes.
- Redaction stops descending past 20 levels of nesting rather than recursing arbitrarily deep, so a pathological or maliciously deep object can't crash the process — see [Redaction](#redaction).
- Custom Error properties are scrubbed against a built-in sensitive-name list by default, independent of your `redact` config — see [Error property redaction](#error-property-redaction) for how to configure or disable this.
- Incoming `X-Request-ID` header values are validated against a strict allowlist pattern before being trusted; anything else is discarded in favor of a freshly generated ID.
- Request bodies are never read or logged by `log.middleware()`.

What this **isn't**: an audit of what you choose to log, encryption for output, or a substitute for a real secrets-management story. `redact` is a safety net for field names you tell it about (plus a conservative built-in list for Error extras) — it can't redact a secret that ends up in the `message` string itself, or a field name it's never heard of.

## Configuration validation

- **`level` and `format`** (plain strings) never throw on an invalid value — they fall back to the default, since these often come from environment variables that shouldn't be able to crash your app. This matches v1.0's original contract.
- **Structural configuration you write in code** — `levels`, `redact`, `sampling`, `collapse`, `transports`, `hooks` — throws synchronously at `createLogger()` time on a malformed shape. These are programming errors you want to catch immediately in development, not something that should silently misbehave in production. (Exception, deliberately: `redact`'s object form no longer requires a `paths` key — see [Redaction](#redaction) — since `{ errorProps: false }` on its own is a legitimate, complete configuration.)

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

Calls `flush()`/`close()` on every transport that implements it. Also immediately emits any pending [duplicate-collapse](#duplicate-log-collapsing) summaries rather than waiting for their window to elapse, so a suppressed run of duplicates is never lost on shutdown.

### `consoleTransport(options?)`

The built-in console transport, exported for combining with custom transports. See [Transports](#transports).

### `LEVELS`, `LEVEL_ORDER`

The default level table and its severity order (`["debug", "info", "success", "warn", "error", "fatal"]`).

### `DEFAULT_REDACT_KEYS`

The built-in list of sensitive key names used by `redact: true`.

### `VERSION`

This package's own version string (e.g. `"1.6.0"`) — not related to the per-logger `version` option, which is your *application's* version attached to log output. See [Version & deployment metadata](#version--deployment-metadata).

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

There are no breaking changes. Every v1.0.0 API and behavior — `createLogger()`, `debug/info/success/warn/error`, `level`, `timestamp`, `colors`, `format`, `name`, `child()`, metadata handling, error handling, `NO_COLOR`/`FORCE_COLOR`, CJS/ESM — continues to work exactly as documented. `fatal` is a new, additive level; everything else described above is opt-in via new configuration options. This still holds as of v1.6.0 — the only deprecation to date is `redactErrorProps` (still works, see [Error property redaction](#error-property-redaction)), and every new v1.6 feature (`collapse`, `version`, `deployment`) is opt-in and off by default.

## Node.js compatibility

Requires Node.js `>= 18.0.0`. Ships as CommonJS with a thin ESM wrapper — no build step, no transpilation, no bundler required.

## License

[MIT](./LICENSE)