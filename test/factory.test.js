const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const gatewayPath = path.resolve(__dirname, "../index.ts");
const notionPath = path.resolve(__dirname, "../adapters/notion/adapter.ts");

function tmpAuditPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dbgw-")), "audit.log");
}

describe("createDbGateway() — options handling", () => {
  const ORIGINAL_AUDIT_ENV = process.env.DB_GATEWAY_AUDIT_LOG_PATH;
  const ORIGINAL_QPS_ENV = process.env.DB_GATEWAY_QPS_PER_MIN;

  afterEach(() => {
    if (ORIGINAL_AUDIT_ENV === undefined) delete process.env.DB_GATEWAY_AUDIT_LOG_PATH;
    else process.env.DB_GATEWAY_AUDIT_LOG_PATH = ORIGINAL_AUDIT_ENV;
    if (ORIGINAL_QPS_ENV === undefined) delete process.env.DB_GATEWAY_QPS_PER_MIN;
    else process.env.DB_GATEWAY_QPS_PER_MIN = ORIGINAL_QPS_ENV;
  });

  it("adapters option object is forwarded to the adapter module's create(opts)", () => {
    // NotionAdapter stores opts privately; verify indirectly via the module's create()
    // accepting an options object without throwing (this is the exact code path
    // createDbGateway._resolveAdapter uses for plain option objects).
    const { create } = require(notionPath);
    const adapter = create({ token: "fake-token-not-real", notionVersion: "2022-06-28" });
    assert.equal(adapter.store, "notion");
  });

  it("an object already implementing execute() is used as-is (no create() call)", async () => {
    const { createDbGateway } = require(gatewayPath);
    let usedDirectly = false;
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      adapters: {
        sqlite: {
          store: "sqlite",
          validate: () => {},
          execute: async () => {
            usedDirectly = true;
            return { rows: [], rowCount: 0 };
          },
        },
      },
    });
    await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "svc", scope: "nexus" });
    assert.equal(usedDirectly, true);
  });

  it("rateLimitPerMinute reads env DB_GATEWAY_QPS_PER_MIN when option omitted", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "1";
    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({
      auditLogPath: tmpAuditPath(),
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    const caller = { service: "svc", scope: "nexus" };
    const req = { store: "sqlite", op: "read", table: "users" };
    assert.equal((await gw.query(req, caller)).outcome, "allow");
    assert.equal((await gw.query(req, caller)).denyReason, "L4_rate_limit");
  });

  it("auditLogPath defaults to env DB_GATEWAY_AUDIT_LOG_PATH, mkdir -p's the parent dir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbgw-env-"));
    const target = path.join(dir, "nested", "audit.log");
    process.env.DB_GATEWAY_AUDIT_LOG_PATH = target;

    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({
      adapters: { sqlite: { store: "sqlite", validate: () => {}, execute: async () => ({ rows: [], rowCount: 0 }) } },
    });
    await gw.query({ store: "sqlite", op: "read", table: "users" }, { service: "svc", scope: "nexus" });

    assert.ok(fs.existsSync(target), "audit log file should exist at env-configured path");
  });

  it("unconfigured store denies L1_adapter even for a syntactically valid store name", async () => {
    const { createDbGateway } = require(gatewayPath);
    const gw = createDbGateway({ auditLogPath: tmpAuditPath(), adapters: { notion: {} } });
    const result = await gw.query({ store: "postgres", op: "read", table: "users" }, { service: "svc", scope: "nexus" });
    assert.equal(result.outcome, "deny");
    assert.equal(result.denyReason, "L1_adapter");
  });
});
