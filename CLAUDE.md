# @acegalaxy/lib-db-gateway

> **Private git-dependency library** — Cross-project DB gateway: 5-layer default-deny (postgres/sqlite/notion) with policy ACL, audit log, rate limit, identity resolution.
> Cross-cutting rules: see framework `../../rules/00-index.md`.
> ⭐⭐⭐ **Harness Architecture (P0)**: Mọi feature mới BẮT BUỘC route qua 1 trong 5 surfaces (slash command / hook / subagent / MCP / permission). Đọc `../../rules/meta/02-harness-architecture.md`. KHÔNG add ad-hoc scripts.

## Module purpose

Project-agnostic gateway wrapping DB adapters with default-deny authz + audit. Consumers inject identity map + policy + audit sink callbacks; no global state.

## Key files

- `index.js` — entry point, `createDbGateway()` factory
- `adapters/` — postgres / sqlite / notion drivers
- `authz/` — default-deny engine; policies are plain objects passed at call time via
  `createDbGateway({ policies })` — no bundled YAML
- `audit/`, `rate-limit/`, `identity/` — L5 forensics, L4 DoS guard, identity resolver
- `types.js` — shared types

## Install

Private git-dependency — consumers add
`"@acegalaxy/lib-db-gateway": "github:acegalaxy-co/lib-db-gateway#v0.2.0"` to
`package.json` and `require("@acegalaxy/lib-db-gateway")` like any other npm package. Not
published to the npm registry. No copy-paste of source into consumer repos.

## Tests

`npm test` (runs `node --test test/`).
