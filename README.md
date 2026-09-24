# @acegalaxy/lib-db-gateway

Multi-database adapter (PostgreSQL, SQLite, Notion) with a 5-layer default-deny
security gateway. Funnel every DB call through one entry point with identity
resolution, schema + policy authz, rate-limiting, and an append-only audit log.

Private git-dependency — consumed as `github:acegalaxy-co/lib-db-gateway#v<version>`,
not published to npm.

## Why

Ad-hoc DB calls scattered across a codebase are impossible to audit and easy to
abuse. `lib-db-gateway` centralizes access so every query passes the same checks:

- **Who** is calling (identity resolution)
- **What** they may touch (schema naming rules, optional per-service policy ACL)
- **How fast** they may call (sliding-window rate-limit)
- **What happened** (append-only audit log)

The gateway never throws; it returns `{ outcome, denyReason, rows?, rowCount?, latencyMs }`.

## Install

```json
{
  "dependencies": {
    "@acegalaxy/lib-db-gateway": "github:acegalaxy-co/lib-db-gateway#v0.2.0"
  }
}
```

Local dev/test against a sibling checkout:

```sh
npm install --no-save ../lib-db-gateway
```

CI (this repo and any consumer that installs private `lib-*` git-deps, e.g.
`@acegalaxy/lib-security-utils`) needs the org secret `LIB_DEPS_TOKEN` — a
read-only fine-grained GitHub PAT — so `npm ci`/`npm install` can resolve
`github:acegalaxy-co/...` deps over HTTPS instead of SSH.

## API

```js
const { createDbGateway, query, IDBAdapter } = require("@acegalaxy/lib-db-gateway");

// Factory — full control over adapters, policies, rate limit, audit path, dryRun.
const gw = createDbGateway({
  adapters: { postgres: { pool /* or connectionString */ } },
  policies: {
    "nexus-web": { stores: ["postgres"], ops: ["read"], tables: ["users", "invoices"] },
  },
  rateLimitPerMinute: 60,
  auditLogPath: "/var/log/nexus/db-gateway-audit.log",
});

const res = await gw.query(
  { store: "postgres", op: "read", table: "users", where: { id: 42 } },
  { service: "nexus-web", scope: "nexus" }
);
// { outcome: 'allow' | 'deny', denyReason: string|null, rows?, rowCount?, latencyMs }

// Legacy module-level query — lazily created default instance:
// createDbGateway({ dryRun: true, adapters: { notion: {} } })
// Preserves historical shadow-mode semantics: notion-only, dryRun, never does real I/O.
await query({ store: "notion", op: "read", table: "<db-id>" }, { service: "x", scope: "y" });
```

### `createDbGateway(opts?)`

| Option | Default | Description |
| --- | --- | --- |
| `adapters` | `{}` | Per-store options object (passed to that adapter module's `create(opts)`) or a pre-built object already implementing `execute()`. A store not present here denies `L1_adapter` even if the name is a valid store. |
| `policies` | absent | Absent → legacy behavior (schema check only, no per-table ACL). Present → default-deny: `caller.service` must have an entry; `stores`/`ops`/`tables` arrays support `"*"` wildcard; an omitted dimension is unrestricted. No entry / no match → `L3_policy`. |
| `auditLogPath` | env `DB_GATEWAY_AUDIT_LOG_PATH` → `process.cwd()/logs/db-gateway-audit.log` | Append-only JSONL audit log. Directory is created (`mkdir -p`) on gateway creation. Never resolves inside `node_modules`. |
| `rateLimitPerMinute` | env `DB_GATEWAY_QPS_PER_MIN` → `30` | Sliding-window max requests per `service::store` key per 60s. |
| `dryRun` | `false` | Runs L2 (identity) - L4 (rate limit) plus `adapter.validate(request)` only. No I/O, `rowCount` is `null`. |

### Adapters

| Adapter | Status | File |
| --- | --- | --- |
| `notion` | `validate()` implemented (target-id regex + delete hard-block); `execute()` stub | `adapters/notion.ts` |
| `postgres` | `validate()` implemented (identifier allowlist); `execute()` stub | `adapters/postgres.ts` |
| `sqlite` | `validate()` implemented (identifier allowlist); `execute()` stub | `adapters/sqlite.ts` |

Real `execute()` implementations for `notion` and `postgres` land in later versions
(REST fetch for Notion, `pg` for Postgres — `pg` stays an optional peerDependency,
never a hard dependency of this package).

### `IDBAdapter`

Abstract base (`adapters/adapter-interface.ts`): `store`, `validate(request)` (throws
on invalid, no I/O), `execute(request): Promise<{ rows?, rowCount? }>`.

## Security layers

1. **L2 identity** — `resolveCaller(caller)`, default-deny on missing `service`/`scope`.
2. **L3 schema + authz** — table/column snake_case convention, Notion delete hard-block.
3. **L3 policy** (optional) — per-service store/op/table ACL, default-deny when configured.
4. **L4 rate-limit** — sliding window, per `service::store`.
5. **L1 adapter** — `validate()` (dryRun) or `execute()` (real I/O); unconfigured store denies.

## Changelog

- **0.2.0** — migrated from `@acegalaxy/db-gateway@0.1.2` / Nexus `commons/db-gateway`.
  New `createDbGateway()` factory (adapters/policies/dryRun/auditLogPath/rateLimitPerMinute
  all configurable per instance), `IDBAdapter.validate()`, optional per-service policy ACL
  (`L3_policy`), legacy `query()` kept as a dryRun+notion-only default instance to preserve
  shadow-mode semantics. Security primitives (audit log, caller validation, rate limit)
  now consumed from `@acegalaxy/lib-security-utils` instead of an inlined `lib/`.
