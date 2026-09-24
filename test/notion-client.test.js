const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const clientPath = path.resolve(__dirname, "../adapters/notion/client.ts");
const { createNotionClient } = require(clientPath);

const ORIGINAL_FETCH = globalThis.fetch;

function baseCfg(extra) {
  return Object.assign({
    token: "test-token",
    apiVersion: "2022-06-28",
    baseUrl: "https://api.notion.test",
    rateIntervalMs: 0,
    maxRetries: 3,
    timeoutMs: 5000,
    serverErrorDelayMs: 0,
    networkErrorDelayMs: 0,
    batchDelayMs: 0,
  }, extra || {});
}

function jsonResponse(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (headers && headers[name]) || null,
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

describe("createNotionClient (adapters/notion/client.ts)", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_BASE_URL;
  });

  it("GET ok — sends Authorization Bearer + Notion-Version, prefixes '/' path with baseUrl", async () => {
    let capturedUrl, capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return jsonResponse(200, { ok: true });
    };
    const client = createNotionClient(baseCfg());
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, true);
    assert.equal(capturedUrl, "https://api.notion.test/v1/pages/x");
    assert.equal(capturedHeaders.Authorization, "Bearer test-token");
    assert.equal(capturedHeaders["Notion-Version"], "2022-06-28");
  });

  it("429 with Retry-After '0' then 200 — retries once and succeeds", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, "", { "Retry-After": "0" });
      return jsonResponse(200, { ok: true });
    };
    const client = createNotionClient(baseCfg());
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, true);
    assert.equal(calls, 2);
  });

  it("persistent 500 — returns Response-like {ok:false, status:500} without throwing, fetch called maxRetries+1 times", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(500, "server error");
    };
    const client = createNotionClient(baseCfg({ maxRetries: 3 }));
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, false);
    assert.equal(resp.status, 500);
    assert.equal(await resp.text(), "server error");
    assert.equal(calls, 4);
  });

  it("persistent network error — returns Response-like {ok:false, status:0} without throwing", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      const err = new Error("ECONNRESET");
      err.code = "ECONNRESET";
      throw err;
    };
    const client = createNotionClient(baseCfg({ maxRetries: 2, networkErrorDelayMs: 0 }));
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, false);
    assert.equal(resp.status, 0);
    assert.equal(calls, 3);
  });

  it("mutation PATCH with auditDir writes one JSONL line; GET writes none", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-audit-"));
    globalThis.fetch = async (_url, opts) => {
      if ((opts.method || "GET").toUpperCase() === "PATCH") {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, { ok: true });
    };
    const client = createNotionClient(baseCfg({ auditDir: tmpDir }));

    await client.request("/v1/pages/abc", { method: "PATCH", body: JSON.stringify({ archived: true }) });
    await client.request("/v1/pages/abc");

    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `notion-mutations-${day}.jsonl`);
    assert.ok(fs.existsSync(file), "audit file should exist after a mutation");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.method, "PATCH");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("queryAll paginates across 2 pages via has_more/next_cursor", async () => {
    let calls = 0;
    globalThis.fetch = async (_url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      if (!body.start_cursor) {
        return jsonResponse(200, { results: [{ id: "p1" }], has_more: true, next_cursor: "cursor-2" });
      }
      assert.equal(body.start_cursor, "cursor-2");
      return jsonResponse(200, { results: [{ id: "p2" }], has_more: false, next_cursor: null });
    };
    const client = createNotionClient(baseCfg());
    const pages = await client.queryAll("db-id-123");
    assert.equal(calls, 2);
    assert.deepEqual(pages.map((p) => p.id), ["p1", "p2"]);
  });

  it("hooks: beforeRequest ctx is passed to afterResponse for queryAll (called once per page request)", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async (_url, opts) => {
      fetchCalls++;
      const body = JSON.parse(opts.body);
      if (!body.start_cursor) {
        return jsonResponse(200, { results: [{ id: "p1" }], has_more: true, next_cursor: "cursor-2" });
      }
      return jsonResponse(200, { results: [{ id: "p2" }], has_more: false, next_cursor: null });
    };
    let beforeCalls = 0;
    const seenCtx = [];
    const client = createNotionClient(baseCfg({
      hooks: {
        beforeRequest() { beforeCalls++; return { n: beforeCalls }; },
        afterResponse(ctx) { seenCtx.push(ctx); },
      },
    }));
    await client.queryAll("db-id-123");
    assert.equal(beforeCalls, 2);
    assert.deepEqual(seenCtx, [{ n: 1 }, { n: 2 }]);
    assert.equal(fetchCalls, 2);
  });

  it("hooks: beforeRequest throw — request rejects and fetch is never called", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; return jsonResponse(200, { ok: true }); };
    const client = createNotionClient(baseCfg({
      hooks: {
        beforeRequest() { throw new Error("blocked by beforeRequest"); },
      },
    }));
    await assert.rejects(() => client.request("/v1/pages/x"), /blocked by beforeRequest/);
    assert.equal(fetchCalls, 0);
  });

  it("hooks: afterResponse throwing does not break request — resolved value still returned", async () => {
    globalThis.fetch = async () => jsonResponse(200, { ok: true });
    const client = createNotionClient(baseCfg({
      hooks: {
        afterResponse() { throw new Error("afterResponse boom"); },
      },
    }));
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, true);
  });

  it("options override env — explicit token/baseUrl win over process.env", async () => {
    process.env.NOTION_TOKEN = "env-token";
    process.env.NOTION_BASE_URL = "https://env.notion.test";
    let capturedUrl, capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return jsonResponse(200, { ok: true });
    };
    const client = createNotionClient(baseCfg({ token: "opt-token", baseUrl: "https://opt.notion.test" }));
    await client.request("/v1/pages/x");
    assert.equal(capturedUrl, "https://opt.notion.test/v1/pages/x");
    assert.equal(capturedHeaders.Authorization, "Bearer opt-token");
  });

  // callerSkip only trims which frame is *reported* as the caller — it can't force
  // "no caller at all" because frames still exist further up the stack (the test
  // runner's own internals). So the observable contract is: with callerSkip
  // matching this test file, the reported `at` (if any) no longer points into this
  // test file, whereas without it, `at` does point into this test file.

  it("callerSkip absent — caller `at` points into this test file", async () => {
    globalThis.fetch = async () => jsonResponse(200, { ok: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-audit-"));
    const client = createNotionClient(baseCfg({ auditDir: tmpDir }));
    await client.request("/v1/pages/abc", { method: "PATCH", body: JSON.stringify({ archived: true }) });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `notion-mutations-${day}.jsonl`);
    const record = JSON.parse(fs.readFileSync(file, "utf8").trim());
    assert.ok(record.caller, "caller should be resolved when nothing is skipped");
    assert.match(record.caller.at, /notion-client\.test\.js/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("callerSkip (string) — matching this test file, caller no longer points into it", async () => {
    globalThis.fetch = async () => jsonResponse(200, { ok: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-audit-"));
    const client = createNotionClient(baseCfg({ auditDir: tmpDir, callerSkip: ["notion-client.test.js"] }));
    await client.request("/v1/pages/abc", { method: "PATCH", body: JSON.stringify({ archived: true }) });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `notion-mutations-${day}.jsonl`);
    const record = JSON.parse(fs.readFileSync(file, "utf8").trim());
    if (record.caller) assert.doesNotMatch(record.caller.at, /notion-client\.test\.js/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("callerSkip (RegExp) — same skip effect as the string form", async () => {
    globalThis.fetch = async () => jsonResponse(200, { ok: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-audit-"));
    const client = createNotionClient(baseCfg({ auditDir: tmpDir, callerSkip: [/notion-client\.test\.js/] }));
    await client.request("/v1/pages/abc", { method: "PATCH", body: JSON.stringify({ archived: true }) });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `notion-mutations-${day}.jsonl`);
    const record = JSON.parse(fs.readFileSync(file, "utf8").trim());
    if (record.caller) assert.doesNotMatch(record.caller.at, /notion-client\.test\.js/);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("maxRetries invalid (NaN) — falls back to default (3), so persistent 500 retries 4 times total", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return jsonResponse(500, "server error"); };
    const client = createNotionClient(baseCfg({ maxRetries: NaN, serverErrorDelayMs: 0 }));
    const resp = await client.request("/v1/pages/x");
    assert.equal(resp.ok, false);
    assert.equal(calls, 4); // default maxRetries=3 → 1 initial + 3 retries
  });

  it("networkErrorDelayMs invalid (negative) — resolveNotionConfig() falls back to default (5000)", () => {
    const configPath = path.resolve(__dirname, "../adapters/notion/config.ts");
    const { resolveNotionConfig } = require(configPath);
    const cfg = resolveNotionConfig({ networkErrorDelayMs: -100 });
    assert.equal(cfg.networkErrorDelayMs, 5000);
  });

  it("no options — falls back to env (NOTION_TOKEN, NOTION_BASE_URL)", async () => {
    process.env.NOTION_TOKEN = "env-token";
    process.env.NOTION_BASE_URL = "https://env.notion.test";
    let capturedUrl, capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return jsonResponse(200, { ok: true });
    };
    const client = createNotionClient({ rateIntervalMs: 0, maxRetries: 0, timeoutMs: 5000 });
    await client.request("/v1/pages/x");
    assert.equal(capturedUrl, "https://env.notion.test/v1/pages/x");
    assert.equal(capturedHeaders.Authorization, "Bearer env-token");
  });
});
