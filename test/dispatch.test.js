const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { createDbGateway } = require(path.resolve(__dirname, "../index.ts"));

function tmpAuditPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dbgw-")), "audit.log");
}

// Injected adapter objects (already implementing execute/validate) — this is the
// documented way to exercise the gateway without touching real adapters, per
// DbGatewayOptions.adapters: "an object already implementing execute is used as-is".

describe("createDbGateway().query — full layer dispatch (factory pattern, adapter injection)", () => {
  it("happy path: read request allowed through all layers, rows + rowCount returned", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      adapters: {
        sqlite: {
          store: "sqlite",
          validate: () => {},
          execute: async () => ({ rows: [{ id: 1, name: "user1" }], rowCount: 1 }),
        },
      },
    });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });

    assert.equal(result.outcome, "allow");
    assert.equal(result.denyReason, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, 1);
    assert.equal(result.rowCount, 1);
    assert.ok(result.latencyMs >= 0);
  });

  it("L2 deny: unknown caller (missing service)", async () => {
    const gw = createDbGateway({ auditLogPath: tmpAuditPath() });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L2_unknown_caller");
    assert.equal(result.rows, undefined);
  });

  it("L3 deny: invalid schema (missing op)", async () => {
    const gw = createDbGateway({ auditLogPath: tmpAuditPath() });
    const result = await gw.query({ store: "sqlite", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L3_schema");
  });

  it("L3 deny: notion delete hard-block", async () => {
    const gw = createDbGateway({ auditLogPath: tmpAuditPath(), adapters: { notion: {} } });
    const result = await gw.query(
      { store: "notion", op: "delete", table: "12345678-90ab-cdef-1234-567890abcdef" },
      { service: "nexus-bot", scope: "nexus" }
    );
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L3_notion_delete");
  });

  it("L3 deny: policy configured, caller.service has no entry", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      policies: { "other-service": { stores: ["*"] } },
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L3_policy");
  });

  it("L3 allow: policy configured, wildcard entry matches", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      policies: { "nexus-bot": { stores: ["*"], ops: ["*"], tables: ["*"] } },
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "allow");
  });

  it("L4 deny: rate limit exceeded", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      rateLimitPerMinute: 1,
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    const caller = { service: "nexus-bot", scope: "nexus" };
    const req = { store: "sqlite", op: "read", table: "users" };
    const first = await gw.query(req, caller);
    assert.equal(first.outcome, "allow");
    const second = await gw.query(req, caller);
    assert.equal(second.outcome, "deny");
    assert.equal(second.denyReason, "L4_rate_limit");
  });

  it("L1 deny: adapter not configured", async () => {
    const gw = createDbGateway({ auditLogPath: tmpAuditPath() });
    const result = await gw.query({ store: "unknown_db", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });

  it("L1 deny: adapter throws error (swallowed, never crashes)", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      adapters: {
        postgres: {
          store: "postgres",
          validate: () => {},
          execute: async () => {
            throw new Error("connection refused");
          },
        },
      },
    });
    const result = await gw.query({ store: "postgres", op: "read", table: "users" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });

  it("happy path: write request with rowCount in result", async () => {
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      adapters: {
        postgres: {
          store: "postgres",
          validate: () => {},
          execute: async () => ({ rows: [], rowCount: 5 }),
        },
      },
    });
    const result = await gw.query({ store: "postgres", op: "write", table: "events" }, { service: "nexus-bot", scope: "nexus" });
    assert.equal(result.outcome, "allow");
    assert.equal(result.rowCount, 5);
  });

  it("audit log file receives a JSONL record with caller details", async () => {
    const auditLogPath = tmpAuditPath();
    const gw = createDbGateway({
      auditLogPath,
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "my-service", scope: "my-scope" });

    const content = fs.readFileSync(auditLogPath, "utf8").trim();
    const rec = JSON.parse(content.split("\n").pop());
    assert.equal(rec.callerService, "my-service");
    assert.equal(rec.callerScope, "my-scope");
    assert.equal(rec.outcome, "allow");
  });
});
