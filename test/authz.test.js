const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const modulePath = path.resolve(__dirname, "../authz/engine.ts");

function freshRequire() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

describe("authz-engine: check() (schema + baseline authz, Phase 1)", () => {
  it("accepts valid request with all required fields", async () => {
    const { check } = freshRequire();
    const result = await check(
      { service: "nexus-bot", scope: "nexus" },
      { store: "sqlite", op: "read", table: "users" }
    );
    assert.equal(result.allow, true);
  });

  it("rejects request missing store", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "nexus-bot", scope: "nexus" }, { op: "read", table: "users" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");
  });

  it("rejects request missing op", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "nexus-bot", scope: "nexus" }, { store: "sqlite", table: "users" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");
  });

  it("rejects request missing table", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "nexus-bot", scope: "nexus" }, { store: "sqlite", op: "read" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");
  });

  it("rejects null/undefined request", async () => {
    const { check } = freshRequire();
    assert.equal((await check({ service: "s", scope: "s" }, null)).allow, false);
    assert.equal((await check({ service: "s", scope: "s" }, undefined)).allow, false);
  });

  it("validates table naming convention for postgres/sqlite", async () => {
    const { check } = freshRequire();

    let result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "read", table: "user_profiles" });
    assert.equal(result.allow, true);

    result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "read", table: "UserProfiles" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");

    result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "read", table: "user-profiles" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");
  });

  it("allows UUID-like table names for notion", async () => {
    const { check } = freshRequire();
    const result = await check(
      { service: "s", scope: "s" },
      { store: "notion", op: "read", table: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
    );
    assert.equal(result.allow, true);
  });

  it("validates column naming convention", async () => {
    const { check } = freshRequire();

    let result = await check(
      { service: "s", scope: "s" },
      { store: "postgres", op: "read", table: "users", columns: ["id", "user_name", "email"] }
    );
    assert.equal(result.allow, true);

    result = await check(
      { service: "s", scope: "s" },
      { store: "postgres", op: "read", table: "users", columns: ["id", "UserName"] }
    );
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_schema");
  });

  it("rejects delete operation on notion store", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "s", scope: "s" }, { store: "notion", op: "delete", table: "db-id" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_notion_delete");
  });

  it("allows archive operation on notion (different from delete)", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "s", scope: "s" }, { store: "notion", op: "archive", table: "db-id" });
    assert.equal(result.allow, true);
  });

  it("allows update with archived=true on notion", async () => {
    const { check } = freshRequire();
    const result = await check(
      { service: "s", scope: "s" },
      { store: "notion", op: "update", table: "db-id", data: { archived: true } }
    );
    assert.equal(result.allow, true);
  });

  it("allows delete on postgres/sqlite", async () => {
    const { check } = freshRequire();

    let result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "delete", table: "users" });
    assert.equal(result.allow, true);

    result = await check({ service: "s", scope: "s" }, { store: "sqlite", op: "delete", table: "users" });
    assert.equal(result.allow, true);
  });

  it("defaults to allow when all schema checks pass (Phase 1, no policies)", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "any-service", scope: "any-scope" }, { store: "postgres", op: "write", table: "any_table" });
    assert.equal(result.allow, true);
  });

  it("handles empty columns array", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "read", table: "users", columns: [] });
    assert.equal(result.allow, true);
  });

  it("single underscore table name valid", async () => {
    const { check } = freshRequire();
    const result = await check({ service: "s", scope: "s" }, { store: "postgres", op: "read", table: "a_b_c_d" });
    assert.equal(result.allow, true);
  });
});

describe("authz-engine: checkPolicy() (per-service ACL, new in 0.2.0)", () => {
  it("denies L3_policy when caller.service has no entry", () => {
    const { checkPolicy } = freshRequire();
    const result = checkPolicy({}, { service: "nexus-web", scope: "nexus" }, { store: "postgres", op: "read", table: "users" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_policy");
  });

  it("allows when store/op/table explicitly listed", () => {
    const { checkPolicy } = freshRequire();
    const policies = { "nexus-web": { stores: ["postgres"], ops: ["read"], tables: ["users"] } };
    const result = checkPolicy(policies, { service: "nexus-web", scope: "nexus" }, { store: "postgres", op: "read", table: "users" });
    assert.equal(result.allow, true);
  });

  it("denies when table not in allowlist", () => {
    const { checkPolicy } = freshRequire();
    const policies = { "nexus-web": { stores: ["postgres"], ops: ["read"], tables: ["users"] } };
    const result = checkPolicy(policies, { service: "nexus-web", scope: "nexus" }, { store: "postgres", op: "read", table: "invoices" });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "L3_policy");
  });

  it("wildcard '*' allows any value for that dimension", () => {
    const { checkPolicy } = freshRequire();
    const policies = { "nexus-web": { stores: ["*"], ops: ["*"], tables: ["*"] } };
    const result = checkPolicy(policies, { service: "nexus-web", scope: "nexus" }, { store: "notion", op: "write", table: "anything" });
    assert.equal(result.allow, true);
  });

  it("omitted dimension is unrestricted", () => {
    const { checkPolicy } = freshRequire();
    const policies = { "nexus-web": { tables: ["users"] } };
    const result = checkPolicy(policies, { service: "nexus-web", scope: "nexus" }, { store: "sqlite", op: "write", table: "users" });
    assert.equal(result.allow, true);
  });
});
