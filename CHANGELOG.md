# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-31

### Added

- Production JSON output flattens context and metadata onto the top-level entry, matching common log-aggregator expectations, with reserved-key collisions still namespaced (`meta_<key>`).
- Deterministic per-level log sampling (`sampling: { debug: 0.1 }`) — emits exactly the 1st of every N eligible messages rather than a randomized sample, so behavior is predictable and testable. Levels not listed are never sampled.
- Opt-in source location capture (`source: true`), adding a `[file:line]` tag in pretty mode and a `source` field in JSON mode. Deliberately opt-in since stack inspection is not part of the default fast path.
- `Error` `cause` chains (`new Error(msg, { cause })`) are serialized recursively and rendered under a "Caused by:" heading in pretty mode.
- Custom own properties on logged `Error` objects are preserved under `error.extra`.
- A benchmark suite under `bench/` (not published to npm) covering disabled levels, basic/JSON logging, metadata size, redaction, and context overhead.

### Changed

- Internal formatting/error-serialization code paths reorganized around the structured entry introduced in 1.4.0; no public behavior change beyond what's listed here.

### Security

- Custom properties on logged `Error` objects are now scrubbed against the built-in sensitive-key list by default (independent of any `redact` config), since HTTP client libraries often attach credential-bearing data (e.g. `error.config.headers.authorization`) that a developer never consciously chose to log. Disable with `redactErrorProps: false`.
- A property getter that throws while formatting metadata now degrades that single field to `"[unreadable]"` instead of losing the entire log line.
- Documented exactly which configuration options throw synchronously at `createLogger()` time (`levels`, `redact`, `sampling`, `transports`, `hooks`) versus which fail safe to a default (`level`, `format`), matching and extending v1.0's existing fallback contract.

### Performance

- Sampling is checked immediately after the level filter, before any redaction, context merging, or formatting.
- Redaction is fully skipped (no allocation) when `redact` isn't configured.
- Metadata/context objects are only copied when there's something to merge; a plain `log.info(msg, data)` call with no active context passes `data` through by reference until formatting.

## [1.4.0] - 2026-08-31

### Added

- Internal logs are now represented as structured entries (`{ timestamp, level, message, name, context, metadata, error, source }`) flowing through a transport pipeline, enabling custom output destinations.
- A transport interface: any object with a `log(entry)` method, with optional `flush()`/`close()` lifecycle methods callable via `logger.flush()`/`logger.close()`.
- `consoleTransport()`, the built-in terminal/JSON output, exported so it can be combined with custom transports (`transports: [consoleTransport(), myTransport]`).
- Lifecycle hooks (`hooks: { before, after }`): `before` can mutate an entry or cancel logging by returning `false`; `after` runs once transports have received the entry.
- Custom levels (`levels: { trace: 5, ... }`), additive on top of the built-ins by default, with validation against reserved method names and duplicate numeric values.

### Changed

- Supplying `transports` now replaces the default console transport entirely (include `consoleTransport()` explicitly to keep terminal output alongside custom transports).

### Fixed

- A transport or hook that throws is now caught and ignored (with a one-time stderr warning) instead of crashing the application or blocking other transports/hooks.

## [1.3.0] - 2026-08-31

### Added

- `AsyncLocalStorage`-based ambient request context via `log.runWithContext(fields, fn)`, using only Node built-ins. Context survives `await`, promises, timers, and nested async callbacks, and nested `runWithContext` calls merge with the inner context winning on collisions.
- Automatic, cryptographically-generated request IDs (`req_<hex>`) via `node:crypto`.
- `log.requestContext(options?)`: context-only middleware (request-ID generation + propagation, no automatic logging), compatible with Express and raw `http` servers.
- `log.middleware(options?)`: full request logging middleware — automatic method/path/status/duration/request-ID logging on response finish, with configurable status→level mapping, route ignoring, and custom fields. Works as Express middleware or as a raw `http.createServer` request listener.

### Security

- An incoming `X-Request-ID` (or configured header) is only trusted if it matches a strict allowlist pattern (`/^[A-Za-z0-9_-]{1,128}$/`); anything else is discarded in favor of a freshly generated ID rather than flowing an arbitrary upstream value into your logs.
- `log.middleware()` never reads or logs request bodies.

## [1.2.0] - 2026-08-31

### Added

- Log redaction (`redact: [...]`), supporting bare key names (matched recursively at any depth) and dotted paths (`"user.password"`, with a `*` single-segment wildcard: `"*.password"`).
- Object form for a custom replacement string: `redact: { paths: [...], replacement: "[HIDDEN]" }` (default replacement: `"[REDACTED]"`).
- `redact: true` shortcut enabling a built-in list of common sensitive key names, exported as `DEFAULT_REDACT_KEYS`.
- Redaction works recursively through nested objects and arrays, in both pretty and JSON mode, and is applied to persistent/ambient context as well as explicit metadata.

### Security

- Redaction never mutates the caller's original object.
- Redaction treats class instances (`Error`, `Date`, `Map`, custom classes) as opaque leaves rather than reflecting into their internals, avoiding hostile-getter and encapsulation issues.

## [1.1.0] - 2026-08-31

### Added

- `fatal()` level, ordered above `error` (`debug < info < success < warn < error < fatal`).
- `log.time(label)` / `timer.end(message?, meta?)` timers using `process.hrtime.bigint()` for high-resolution, async-safe duration measurement. Repeated `.end()` calls are a safe no-op. `log.time()`/`log.timeEnd()` also support a `console.time()`-style pairing by label.
- `log.withContext(fields)`: a persistent logger view that attaches fields to every subsequent message, with documented precedence (explicit metadata overrides persistent context).
- `log.once(key, message, meta?)`: logs a message only the first time a given key is seen, shared across a logger and its `.child()`/`.withContext()` descendants. `log.resetOnce(key?)` clears state.
- Environment-aware configuration: `level: "auto"`, `format: "auto"`, `colors: "auto"`, resolving conservatively from `NODE_ENV`, `CI`, and TTY status.

## [1.0.0] - 2026-08-30

### Added

- Initial public release.
- `createLogger()` factory with `debug`, `info`, `success`, `warn`, and `error` levels.
- Pretty terminal output with automatic TTY color detection, plus a `colors` option and support for the `NO_COLOR` / `FORCE_COLOR` environment variables.
- Structured metadata logging: `key=value` pairs in pretty mode, merged top-level fields in JSON mode.
- Dedicated `Error` handling that renders the error message and stack trace.
- JSON output mode (`format: "json"`) for production log aggregation, with automatic namespacing of metadata keys that collide with reserved fields.
- Namespaced loggers via the `name` option and `log.child(name)`, with `:`-joined namespaces for nested children.
- Configurable minimum log level (`level` option), with graceful fallback to the default on invalid values instead of throwing.
- Configurable timestamps (`timestamp` option).
- Safe handling of circular references, `Error` objects, `BigInt`, and other unusual values in both pretty and JSON modes.
- Zero runtime dependencies. Works via both CommonJS (`require`) and ESM (`import`) with no build step.
- Full test suite (26 tests) using Node's built-in test runner (`node:test`).

[1.5.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.5.0
[1.0.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.0.0
