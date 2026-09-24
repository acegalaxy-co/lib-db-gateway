# Changelog

All notable changes to @acegalaxy/lib-db-gateway will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-24

### Added
- `createNotionClient()` — generic Notion transport client under `adapters/notion/`
  (`client.ts`, `config.ts`, `rate.ts`): proactive rate limiting, 429/5xx/network-error
  retry, mutation audit log (JSONL, reuses `@acegalaxy/lib-security-utils/audit-log`),
  and `hooks.beforeRequest`/`hooks.afterResponse` for consumer-specific gating (e.g. a
  "assert parent db" check) instead of hardcoding it. Env (`NOTION_TOKEN`,
  `NOTION_BASE_URL`, `NOTION_API_VERSION`, `NOTION_RATE_INTERVAL_MS`, ...) is read
  lazily at `createNotionClient()` call time; an explicit options object always
  overrides env.
- `adapters/notion/index.ts` re-exports both the existing `NotionAdapter`/`create`
  (moved from `adapters/notion.ts` → `adapters/notion/adapter.ts`, unchanged) and the
  new client — `require("@acegalaxy/lib-db-gateway/adapters/notion")` keeps working.

### Changed
- `adapters/notion.ts` moved to `adapters/notion/adapter.ts` (directory layout, no
  behavior change); `package.json#exports["./adapters/notion"]` updated to
  `./dist/adapters/notion/index.js`.

## [0.2.0] - 2026-09-24

### Changed
- **BREAKING**: renamed package `@acegalaxy/db-gateway` → `@acegalaxy/lib-db-gateway`; repo
  renamed `ace_commons-db-gateway-nodejs` → `lib-db-gateway`. No longer published to npm —
  consumed as a private git-dependency: `github:acegalaxy-co/lib-db-gateway#v0.2.0`.
- Depends on `@acegalaxy/lib-security-utils` v0.3.0 (shared rate-limit primitive).
- Added `createDbGateway()` factory (adapters/policies/rate-limit/audit-path/`dryRun` all
  configurable per instance) alongside the legacy module-level `query()`.
- Notion and Postgres adapters added (previously Postgres/SQLite/Notion stubs).
- `dryRun` mode: runs L2-L4 + adapter `validate()` only, no I/O, `rowCount: null`.
- Rate-limit env (`DB_GATEWAY_QPS_PER_MIN`) now read lazily on every check instead of once
  at module load.
- CI installs private git-deps via `LIB_DEPS_TOKEN` org secret; npm publish workflow removed.

## [0.1.0] - 2026-05-06

### Added
- Initial public release.
- Multi-DB adapter (Postgres + SQLite + Notion) with 5-layer authz.
- TypeScript source with `.d.ts` declarations shipped in `dist/`.
- MIT license.

[Unreleased]: https://github.com/acegalaxy-co/lib-db-gateway/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/acegalaxy-co/lib-db-gateway/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/acegalaxy-co/lib-db-gateway/releases/tag/v0.1.0
