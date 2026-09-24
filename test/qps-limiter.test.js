const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const modulePath = path.resolve(__dirname, "../rate-limit/limiter.ts");

function freshRequire() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

describe("QPS limiter (rate-limit/limiter.ts wrapper)", () => {
  const ORIGINAL_ENV = process.env.DB_GATEWAY_QPS_PER_MIN;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.DB_GATEWAY_QPS_PER_MIN;
    else process.env.DB_GATEWAY_QPS_PER_MIN = ORIGINAL_ENV;
  });

  it("defaults MAX_REQUESTS to 30 when env unset", () => {
    delete process.env.DB_GATEWAY_QPS_PER_MIN;
    const { MAX_REQUESTS, WINDOW_MS } = freshRequire();
    assert.equal(MAX_REQUESTS, 30);
    assert.equal(WINDOW_MS, 60 * 1000);
  });

  it("reads MAX_REQUESTS from DB_GATEWAY_QPS_PER_MIN env at load time", () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "2";
    const { MAX_REQUESTS } = freshRequire();
    assert.equal(MAX_REQUESTS, 2);
  });

  it("check(service, store) returns true (boolean) while under quota", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "5";
    const { check } = freshRequire();
    const ok = await check("nexus-bot", "sqlite");
    assert.equal(ok, true);
    assert.equal(typeof ok, "boolean");
  });

  it("check(service, store) returns false once quota exhausted for that service::store key", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "2";
    const { check } = freshRequire();

    assert.equal(await check("nexus-bot", "sqlite"), true);
    assert.equal(await check("nexus-bot", "sqlite"), true);
    assert.equal(await check("nexus-bot", "sqlite"), false);
  });

  it("buckets independently per service::store — different store not affected by exhausted key", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "1";
    const { check } = freshRequire();

    assert.equal(await check("nexus-bot", "sqlite"), true);
    assert.equal(await check("nexus-bot", "sqlite"), false);

    assert.equal(await check("nexus-bot", "postgres"), true);
  });

  it("empty service name always denies (keyFn produces empty key)", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "10";
    const { check } = freshRequire();
    assert.equal(await check("", "sqlite"), false);
    assert.equal(await check(undefined, "sqlite"), false);
  });

  it("createLimiter(n) returns an independent bucket from the module-level default", async () => {
    process.env.DB_GATEWAY_QPS_PER_MIN = "50";
    const { createLimiter, check } = freshRequire();
    const custom = createLimiter(1);

    assert.equal(await custom.check("svc-x", "sqlite"), true);
    assert.equal(await custom.check("svc-x", "sqlite"), false); // custom exhausted at 1

    // Module-level default limiter (maxRequests=50) unaffected by custom instance.
    assert.equal(await check("svc-x", "sqlite"), true);
  });
});
