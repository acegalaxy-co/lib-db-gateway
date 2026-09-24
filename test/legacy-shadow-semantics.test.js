const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const gatewayPath = path.resolve(__dirname, "../index.ts");

// The legacy module-level `query()` export = createDbGateway({ dryRun: true, adapters: { notion: {} } }).
// This preserves the historical "shadow mode" contract used by consumers that dispatch
// notion calls through the gateway purely for validation/audit, never real I/O:
//   - dryRun: never calls adapter.execute(), only adapter.validate()
//   - notion only: sqlite/postgres always deny L1_adapter (never configured)
//   - delete is hard-blocked
//   - unparseable target denies L1_adapter (validate() throws, swallowed)

describe("legacy query() — shadow-mode semantics preserved", () => {
  it("valid notion read target → allow, rowCount null (dryRun, no real I/O)", async () => {
    const { query } = require(gatewayPath);
    const result = await query(
      { store: "notion", op: "read", table: "12345678-90ab-cdef-1234-567890abcdef" },
      { service: "nexus-notion-helpers", scope: "nexus" }
    );
    assert.equal(result.outcome, "allow");
    assert.equal(result.denyReason, null);
    assert.equal(result.rowCount, null);
    assert.equal(result.rows, undefined);
  });

  it("SHADOW_TARGET form (notion:<type>:<8hex>) → allow", async () => {
    const { query } = require(gatewayPath);
    const result = await query(
      { store: "notion", op: "update", table: "notion:pages:abcdef12" },
      { service: "nexus-notion-helpers", scope: "nexus" }
    );
    assert.equal(result.outcome, "allow");
  });

  it("unparseable target → deny L1_adapter (validate() throws, swallowed, never throws to caller)", async () => {
    const { query } = require(gatewayPath);
    const result = await query(
      { store: "notion", op: "read", table: "not-a-valid-target" },
      { service: "nexus-notion-helpers", scope: "nexus" }
    );
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });

  it("delete on notion → hard-blocked at L3 (never reaches adapter)", async () => {
    const { query } = require(gatewayPath);
    const result = await query(
      { store: "notion", op: "delete", table: "12345678-90ab-cdef-1234-567890abcdef" },
      { service: "nexus-notion-helpers", scope: "nexus" }
    );
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L3_notion_delete");
  });

  it("sqlite/postgres are never configured on the legacy default instance → always L1_adapter", async () => {
    const { query } = require(gatewayPath);
    const caller = { service: "nexus-notion-helpers", scope: "nexus" };
    const sqliteResult = await query({ store: "sqlite", op: "read", table: "users" }, caller);
    const pgResult = await query({ store: "postgres", op: "read", table: "users" }, caller);
    assert.equal(sqliteResult.denyReason, "L1_adapter");
    assert.equal(pgResult.denyReason, "L1_adapter");
  });

  it("dryRun never calls adapter.execute() — only validate() runs", async () => {
    const { createDbGateway } = require(gatewayPath);
    let executeCalled = false;
    let validateCalled = false;
    const gw = createDbGateway({
      dryRun: true,
      adapters: {
        sqlite: {
          store: "sqlite",
          validate: () => {
            validateCalled = true;
          },
          execute: async () => {
            executeCalled = true;
            throw new Error("execute must never be called in dryRun");
          },
        },
      },
    });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "svc", scope: "nexus" });
    assert.equal(result.outcome, "allow");
    assert.equal(result.rowCount, null);
    assert.equal(validateCalled, true);
    assert.equal(executeCalled, false);
  });

  it("dryRun: adapter.validate() throwing → deny L1_adapter, no crash", async () => {
    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({
      dryRun: true,
      adapters: {
        sqlite: {
          store: "sqlite",
          validate: () => {
            throw new Error("bad request");
          },
          execute: async () => ({ rows: [], rowCount: 0 }),
        },
      },
    });
    const result = await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "svc", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });
});
