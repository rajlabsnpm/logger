# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-09-04

### Added

- **Version/deployment metadata.** Every JSON log line now carries a `version` field, auto-detected from the *consuming application's* `package.json` (`process.cwd()`, not walked up the directory tree — this library's own version is still the separate `VERSION` export). Override it with `createLogger({ version: "2.3.1" })`, or turn it off entirely with `version: false`. A `deployment` field (e.g. a git SHA or release tag) is available via `createLogger({ deployment: "blue-7f3a2c1" })` — this one is opt-in only, with no attempt at auto-detecting any specific hosting platform. Both are JSON-only, following the same convention as `pid`/`hostname`; pretty-mode output is unchanged. Both are added to the reserved-key list, so a metadata field literally named `version` or `deployment` is namespaced to `meta_version`/`meta_deployment`.
- **Duplicate-log-line collapsing**, opt-in via `createLogger({ collapse: true })` or `createLogger({ collapse: { windowMs: 5000, maxTracked: 1000 } })` (shown values are the defaults). Two calls are considered duplicates when they share the same level, logger name, message text, and (if present) error name+message — metadata/context is deliberately *not* part of that comparison, since it usually carries the one varying detail (an attempt count, a request id) of an otherwise-repeated call. The first occurrence of a new duplicate key is always logged in full and immediately; while more matching calls keep arriving, they're counted rather than logged; once `windowMs` passes with no further matches (or `logger.flush()`/`logger.close()` is called), a single summary entry is emitted carrying the count and the metadata/error from the *most recent* suppressed call, under a new `collapsed: { count, windowMs }` field (JSON) or a `(+N more in Xs)` suffix (pretty). The original `message` text is never altered, so JSON log aggregation/grouping by exact message still works on both the full entry and the summary. A message that never actually repeats produces no summary line and costs one `Map` entry plus one (`unref`'d) timer for at most `windowMs`. Simultaneous distinct tracked keys are capped by `maxTracked`; once full, additional distinct keys are simply logged uncollapsed rather than evicting an in-progress window or dropping anything. Hooks and transports only see the first occurrence and the periodic summary, not every suppressed call — the same trade-off `sampling` already makes. Disabled by default; the disabled path costs one boolean check.
- **`redact: { errorProps }`**, unifying error-prop redaction into the same config surface as `redact`. See Deprecated below.
- A one-time warning when the internal timer registry (`log.time(label)`) grows past 10,000 simultaneously-open entries, the usual sign of labels built from something unique per call (e.g. a request ID) whose timers are never `.end()`ed. The guard only warns — it never deletes a timer, since that would trade a memory leak for a silently-wrong duration measurement.
- `bench/errors.js` and `bench/collapse.js`, benchmarking error serialization and the new collapsing feature (including its overhead when nothing actually collapses).

### Deprecated

- `createLogger({ redactErrorProps })` (top-level) is deprecated in favor of `createLogger({ redact: { errorProps } })` — same behavior, one config surface instead of two overlapping ones. The old option still works during the 1.x line and emits a one-time deprecation warning; if both are supplied, the new `redact.errorProps` wins. See the Redaction section of the README for the full migration note.

### Changed

- `redact`'s object form no longer requires a `paths` key (`createLogger({ redact: { errorProps: false } })` is now valid on its own); omitted `paths` defaults to `[]`. `redact: {}` is now a harmless no-op instead of throwing.
- A `redact` config with zero effective rules (e.g. `{ errorProps: false }` with no `paths`) no longer walks context/metadata on every log call — previously, any non-empty `redact` option enabled a full traversal even when nothing could ever match.

### Security

- **Hostile getters on the `Error` object's own `name`, `message`, `stack`, or `cause` properties no longer crash the entire log call.** Previously, only custom/extra properties on a logged error were guarded this way (via v1.5.0's existing `[unreadable]` fallback); the error's own core fields had no such guard and a throwing getter on any of them propagated out of `_log()` uncaught. Each now degrades independently to a safe default (matching the existing `error.name || 'Error'` fallback semantics) instead of taking down the call.
- **A hostile `constructor` getter on a nested value during redaction no longer crashes; it's now treated as an opaque leaf**, consistent with how `Date`/`Map`/other class instances were already handled.
- **Metadata, context, and `Error` extra-property *key names* are now sanitized against control characters and ANSI escapes in pretty mode**, closing a gap in the v1.5.1 log-injection fix, which only sanitized *values*. A key like `"ok\nFAKE fatal: system compromised"` could previously still forge what looked like an additional, independent log line even though a value containing the same payload could not. JSON mode was never affected (`JSON.stringify` already escapes control characters in both keys and values) and is unchanged.

### Performance

- `bench/collapse.js`: with collapsing enabled and a genuine flood of identical messages, throughput is roughly 5-8x the disabled baseline on this machine, since suppressed calls skip redaction, hook execution, and the transport entirely. With collapsing enabled but no message ever actually repeating (the worst case — pure tracking overhead, no payoff), throughput drops to roughly half the baseline; this is opt-in and only worth enabling where at least some repetition is expected. See `bench/collapse.js` for exact numbers on your machine — measurements are not claims.
- `bench/errors.js`: the new hostile-getter guards in error serialization add no measurable overhead for well-behaved errors (the overwhelmingly common case) — they only add a `try`/`catch` around property reads that were already being performed.



### Fixed

- **Timer registry memory leak.** `logger.time(label)` followed by `timer.end()` — the primary documented usage pattern — left the timer's entry in an internal registry forever, growing unboundedly with sustained use (confirmed: 50,000 properly-ended timers left 50,000 entries behind). Every timer now removes its own entry on completion, identified by reference rather than by label, so a timer can never accidentally delete a different, still-running timer that reused the same label in the meantime. `logger.timeEnd(label)`, repeated `.end()` calls, async timers, and child-logger timer sharing all continue to work exactly as before.
- **Pretty-mode log injection.** An untrusted `message`, metadata value, or error name/message could previously inject raw newlines, carriage returns, or ANSI/terminal escape sequences into pretty-mode output, forging what looked like an additional, independent log line or manipulating the terminal. These are now rendered as visible, inert text (e.g. a literal newline becomes the two characters `\n`) instead of raw control bytes; normal printable Unicode is unaffected. JSON mode was not affected by this (`JSON.stringify` already escapes control characters) and is unchanged.
- **Redaction stack-overflow DoS.** A sufficiently deeply nested object or array passed through an enabled `redact` config could crash the process with a stack overflow. Redaction now stops descending past 20 levels of nesting, returning a `"[Redaction depth limit exceeded]"` marker for anything deeper instead of continuing to recurse. Circular-reference detection, normal-depth redaction behavior, and the "never mutate the caller's object" guarantee are unchanged.

### Changed

- JSON output now includes `pid` and `hostname` on every line, resolved once at process start. `pid`/`hostname` were added to the reserved envelope-key list, so metadata using either name is namespaced to `meta_pid`/`meta_hostname` instead of being overwritten or overwriting the process fields. Pretty-mode output is unchanged.
- Disabled-level calls (e.g. `log.debug(...)` when `level: "info"`) are significantly faster. The previous implementation re-validated the level name on every single call, including calls that are filtered out and do nothing else — a redundant check, since the level name reaching it was always already known-valid by construction. That check has been removed from this path; `bench/basic.js`, run repeatedly on this machine, showed roughly a 5-6x improvement on the disabled-level benchmark, with no measurable change to any enabled-level benchmark. No other performance work was done in this release — see the Performance section of the README for what's intentionally left as future work.

## [1.5.0] - 2026-08-31

### Added

- Production JSON output flattens context and metadata onto the top-level entry, matching common log-aggregator expectations, with reserved-key collisions still namespaced (`meta_<key>`).
- Deterministic per-level log sampling (`sampling: { debug: 0.1 }`) — emits exactly the 1st of every N eligible messages rather than a randomized sample, so behavior is predictable and testable. Levels not listed are never sampled.
- Opt-in source location capture (`source: true`), adding a `[file:line]` tag in pretty mode and a `source` field in JSON mode. Deliberately opt-in since stack inspection is not part of the default fast path.
- `Error` `cause` chains (`new Error(msg, { cause })`) are serialized recursively and rendered under a "Caused by:" heading in pretty mode.
- Custom own properties on logged `Error` objects are preserved under `error.extra`.
- A benchmark suite under `bench/` (not published to npm) covering disabled levels, basic/JSON logging, metadata size, redaction, and context overhead.
- Internal logs are now represented as structured entries (`{ timestamp, level, message, name, context, metadata, error, source }`) flowing through a transport pipeline, enabling custom output destinations.
- A transport interface: any object with a `log(entry)` method, with optional `flush()`/`close()` lifecycle methods callable via `logger.flush()`/`logger.close()`.
- `consoleTransport()`, the built-in terminal/JSON output, exported so it can be combined with custom transports (`transports: [consoleTransport(), myTransport]`).
- Lifecycle hooks (`hooks: { before, after }`): `before` can mutate an entry or cancel logging by returning `false`; `after` runs once transports have received the entry.
- Custom levels (`levels: { trace: 5, ... }`), additive on top of the built-ins by default, with validation against reserved method names and duplicate numeric values.
- `AsyncLocalStorage`-based ambient request context via `log.runWithContext(fields, fn)`, using only Node built-ins. Context survives `await`, promises, timers, and nested async callbacks, and nested `runWithContext` calls merge with the inner context winning on collisions.
- Automatic, cryptographically-generated request IDs (`req_<hex>`) via `node:crypto`.
- `log.requestContext(options?)`: context-only middleware (request-ID generation + propagation, no automatic logging), compatible with Express and raw `http` servers.
- `log.middleware(options?)`: full request logging middleware — automatic method/path/status/duration/request-ID logging on response finish, with configurable status→level mapping, route ignoring, and custom fields. Works as Express middleware or as a raw `http.createServer` request listener.
- Log redaction (`redact: [...]`), supporting bare key names (matched recursively at any depth) and dotted paths (`"user.password"`, with a `*` single-segment wildcard: `"*.password"`).
- Object form for a custom replacement string: `redact: { paths: [...], replacement: "[HIDDEN]" }` (default replacement: `"[REDACTED]"`).
- `redact: true` shortcut enabling a built-in list of common sensitive key names, exported as `DEFAULT_REDACT_KEYS`.
- Redaction works recursively through nested objects and arrays, in both pretty and JSON mode, and is applied to persistent/ambient context as well as explicit metadata.
- `fatal()` level, ordered above `error` (`debug < info < success < warn < error < fatal`).
- `log.time(label)` / `timer.end(message?, meta?)` timers using `process.hrtime.bigint()` for high-resolution, async-safe duration measurement. Repeated `.end()` calls are a safe no-op. `log.time()`/`log.timeEnd()` also support a `console.time()`-style pairing by label.
- `log.withContext(fields)`: a persistent logger view that attaches fields to every subsequent message, with documented precedence (explicit metadata overrides persistent context).
- `log.once(key, message, meta?)`: logs a message only the first time a given key is seen, shared across a logger and its `.child()`/`.withContext()` descendants. `log.resetOnce(key?)` clears state.
- Environment-aware configuration: `level: "auto"`, `format: "auto"`, `colors: "auto"`, resolving conservatively from `NODE_ENV`, `CI`, and TTY status.

### Changed

- Internal formatting/error-serialization code paths reorganized around the new structured log entry format; no public behavior change beyond what's listed here.
- Supplying `transports` now replaces the default console transport entirely (include `consoleTransport()` explicitly to keep terminal output alongside custom transports).

### Fixed

- A transport or hook that throws is now caught and ignored (with a one-time stderr warning) instead of crashing the application or blocking other transports/hooks.

### Security

- Custom properties on logged `Error` objects are now scrubbed against the built-in sensitive-key list by default (independent of any `redact` config), since HTTP client libraries often attach credential-bearing data (e.g. `error.config.headers.authorization`) that a developer never consciously chose to log. Disable with `redactErrorProps: false`.
- A property getter that throws while formatting metadata now degrades that single field to `"[unreadable]"` instead of losing the entire log line.
- Documented exactly which configuration options throw synchronously at `createLogger()` time (`levels`, `redact`, `sampling`, `transports`, `hooks`) versus which fail safe to a default (`level`, `format`), matching and extending v1.0's existing fallback contract.
- An incoming `X-Request-ID` (or configured header) is only trusted if it matches a strict allowlist pattern (`/^[A-Za-z0-9_-]{1,128}$/`); anything else is discarded in favor of a freshly generated ID rather than flowing an arbitrary upstream value into your logs.
- `log.middleware()` never reads or logs request bodies.
- Redaction never mutates the caller's original object.
- Redaction treats class instances (`Error`, `Date`, `Map`, custom classes) as opaque leaves rather than reflecting into their internals, avoiding hostile-getter and encapsulation issues.

### Performance

- Sampling is checked immediately after the level filter, before any redaction, context merging, or formatting.
- Redaction is fully skipped (no allocation) when `redact` isn't configured.
- Metadata/context objects are only copied when there's something to merge; a plain `log.info(msg, data)` call with no active context passes `data` through by reference until formatting.

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

[1.6.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.6.0
[1.5.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.5.0
[1.0.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.0.0