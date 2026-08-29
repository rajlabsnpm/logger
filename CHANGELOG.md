# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/rajlabsnpm/logger/releases/tag/v1.0.0