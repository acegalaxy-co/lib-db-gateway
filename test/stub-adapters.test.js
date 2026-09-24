const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const postgresPath = path.resolve(__dirname, "../adapters/postgres.ts");
const sqlitePath = path.resolve(__dirname, "../adapters/sqlite.ts");
const notionPath = path.resolve(__dirname, "../adapters/notion.ts");
const gatewayPath = path.resolve(__dirname, "../index.ts");

describe("PostgresAdapter", () => {
  it("exposes store = 'postgres'", () => {
    const { create } = require(postgresPath);
    const adapter = create();
    assert.equal(adapter.store, "postgres");
  });

  it("validate() accepts a well-formed identifier, throws on bad table name", () => {
    const { create } = require(postgresPath);
    const adapter = create();
    assert.doesNotThrow(() => adapter.validate({ table: "user_profiles" }));
    assert.throws(() => adapter.validate({ table: "User-Profiles" }), /invalid table identifier/);
  });

  it("validate() throws on invalid column/where identifiers", () => {
    const { create } = require(postgresPath);
    const adapter = create();
    assert.throws(() => adapter.validate({ table: "users", columns: ["id", "DROP TABLE"] }), /invalid column identifier/);
    assert.throws(() => adapter.validate({ table: "users", where: { "1=1; --": 1 } }), /invalid where identifier/);
  });

  it("execute() without pool/connectionString rejects 'postgres not configured'", async () => {
    const { create } = require(postgresPath);
    const adapter = create();
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users" }),
      /postgres not configured/
    );
  });

  it("execute() throws even with null/undefined request (no crash on bad input)", async () => {
    const { create } = require(postgresPath);
    const adapter = create();
    await assert.rejects(() => adapter.execute(null), /invalid table identifier/);
    await assert.rejects(() => adapter.execute(undefined), /invalid table identifier/);
  });
});

describe("SqliteAdapter (Phase 1 stub)", () => {
  it("exposes store = 'sqlite'", () => {
    const { create } = require(sqlitePath);
    const adapter = create();
    assert.equal(adapter.store, "sqlite");
  });

  it("validate() accepts a well-formed identifier, throws on bad table name", () => {
    const { create } = require(sqlitePath);
    const adapter = create();
    assert.doesNotThrow(() => adapter.validate({ table: "events" }));
    assert.throws(() => adapter.validate({ table: "Events!" }), /invalid table identifier/);
  });

  it("execute() always throws 'not implemented (Phase 1 stub)' regardless of request shape", async () => {
    const { create } = require(sqlitePath);
    const adapter = create();
    await assert.rejects(
      () => adapter.execute({ op: "write", table: "events", data: { a: 1 } }),
      /SqliteAdapter\.execute not implemented \(Phase 1 stub\)/
    );
  });

  it("execute() throws even with null/undefined request (no crash on bad input)", async () => {
    const { create } = require(sqlitePath);
    const adapter = create();
    await assert.rejects(() => adapter.execute(null), /not implemented \(Phase 1 stub\)/);
    await assert.rejects(() => adapter.execute(undefined), /not implemented \(Phase 1 stub\)/);
  });
});

describe("NotionAdapter", () => {
  it("exposes store = 'notion'", () => {
    const { create } = require(notionPath);
    const adapter = create();
    assert.equal(adapter.store, "notion");
  });

  it("validate() accepts a raw UUID target, throws on unparseable target", () => {
    const { create } = require(notionPath);
    const adapter = create();
    assert.doesNotThrow(() => adapter.validate({ op: "read", table: "12345678-90ab-cdef-1234-567890abcdef" }));
    assert.throws(() => adapter.validate({ op: "read", table: "not-a-uuid" }), /unparseable target/);
  });

  it("validate() accepts SHADOW_TARGET form (notion:<type>:<8hex>)", () => {
    const { create } = require(notionPath);
    const adapter = create();
    assert.doesNotThrow(() => adapter.validate({ op: "read", table: "notion:databases:12345678" }));
  });

  it("validate() hard-blocks delete", () => {
    const { create } = require(notionPath);
    const adapter = create();
    assert.throws(
      () => adapter.validate({ op: "delete", table: "12345678-90ab-cdef-1234-567890abcdef" }),
      /notion\.delete blocked/
    );
  });

  it("execute() without a token rejects 'notion token not configured'", async () => {
    const { create } = require(notionPath);
    const adapter = create();
    const savedToken = process.env.NOTION_TOKEN;
    delete process.env.NOTION_TOKEN;
    try {
      await assert.rejects(
        () => adapter.execute({ op: "read", table: "12345678-90ab-cdef-1234-567890abcdef" }),
        /notion token not configured/
      );
    } finally {
      if (savedToken === undefined) {
        delete process.env.NOTION_TOKEN;
      } else {
        process.env.NOTION_TOKEN = savedToken;
      }
    }
  });
});

describe("gateway integration: unconfigured/stub store denies via full flow (real adapters, no stubbing)", () => {
  it("createDbGateway({}) with no adapters configured → deny L1_adapter for any store", async () => {
    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({});
    const result = await gw.query(
      { store: "sqlite", op: "read", table: "users" },
      { service: "nexus-bot", scope: "nexus" }
    );
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
    assert.equal(result.rows, undefined);
    assert.ok(result.latencyMs >= 0);
  });

  it("postgres configured with real (stub) adapter → deny L1_adapter (execute() throws, swallowed)", async () => {
    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({ adapters: { postgres: {} } });
    const result = await gw.query(
      { store: "postgres", op: "write", table: "events" },
      { service: "nexus-bot", scope: "nexus" }
    );
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });

  it("legacy default query() (module-level) always dryRun/notion-only → sqlite/postgres deny L1_adapter (unconfigured)", async () => {
    const { query } = require(gatewayPath);
    const result = await query({ store: "sqlite", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });
});
