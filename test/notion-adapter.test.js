const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const notionPath = path.resolve(__dirname, "../dist/adapters/notion/adapter.js");

const RAW_ID = "12345678-90ab-cdef-1234-567890abcdef";
const FAKE_TOKEN = "test-token";

function jsonResponse(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (headers && headers[name] !== undefined ? headers[name] : null),
    },
    json: async () => body,
  };
}

function fakeFetch(calls, responses) {
  let i = 0;
  return async (url, init) => {
    calls.push({ url, init });
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  };
}

function noSleep(_ms) {
  return Promise.resolve();
}

describe("NotionAdapter.execute — read", () => {
  it("read with where.filter/sorts → POST /databases/{table}/query, rows/rowCount from results", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, { results: [{ id: "a" }, { id: "b" }] })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    const result = await adapter.execute({
      op: "read",
      table: RAW_ID,
      where: { filter: { property: "Status" }, sorts: [{ property: "Name" }] },
    });

    assert.deepEqual(result, { rows: [{ id: "a" }, { id: "b" }], rowCount: 2 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.notion.com/v1/databases/${RAW_ID}/query`);
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.filter, { property: "Status" });
    assert.deepEqual(body.sorts, [{ property: "Name" }]);
    assert.equal(body.page_size, 100);
    assert.equal("start_cursor" in body, false);
  });

  it("read with where.pageId → GET /pages/{id}, rows=[page]", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, { id: "page-1" })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    const result = await adapter.execute({ op: "read", table: RAW_ID, where: { pageId: "page-1" } });

    assert.deepEqual(result, { rows: [{ id: "page-1" }], rowCount: 1 });
    assert.equal(calls[0].url, "https://api.notion.com/v1/pages/page-1");
    assert.equal(calls[0].init.method, "GET");
  });
});

describe("NotionAdapter.execute — create/update/archive", () => {
  it("create/write → POST /pages with parent.database_id + properties", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, { id: "new-page" })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    const result = await adapter.execute({ op: "create", table: RAW_ID, data: { Name: "x" } });

    assert.deepEqual(result, { rows: [{ id: "new-page" }], rowCount: 1 });
    assert.equal(calls[0].url, "https://api.notion.com/v1/pages");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { parent: { database_id: RAW_ID }, properties: { Name: "x" } });
  });

  it("update requires where.pageId, PATCH /pages/{id} with properties", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, { id: "page-1" })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    const result = await adapter.execute({
      op: "update",
      table: RAW_ID,
      where: { pageId: "page-1" },
      data: { Name: "y" },
    });

    assert.deepEqual(result, { rows: [{ id: "page-1" }], rowCount: 1 });
    assert.equal(calls[0].url, "https://api.notion.com/v1/pages/page-1");
    assert.equal(calls[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].init.body), { properties: { Name: "y" } });
  });

  it("update without where.pageId throws, no fetch performed", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, {})]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(() => adapter.execute({ op: "update", table: RAW_ID, data: {} }), /where\.pageId/);
    assert.equal(calls.length, 0);
  });

  it("archive requires where.pageId, PATCH { archived: true }", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, { id: "page-1", archived: true })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    const result = await adapter.execute({ op: "archive", table: RAW_ID, where: { pageId: "page-1" } });

    assert.deepEqual(result, { rows: [{ id: "page-1", archived: true }], rowCount: 1 });
    assert.deepEqual(JSON.parse(calls[0].init.body), { archived: true });
  });

  it("archive without where.pageId throws, no fetch performed", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, {})]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(() => adapter.execute({ op: "archive", table: RAW_ID }), /where\.pageId/);
    assert.equal(calls.length, 0);
  });
});

describe("NotionAdapter.execute — guards", () => {
  it("delete is denied (hard-block, unchanged) — no fetch performed", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, {})]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(() => adapter.execute({ op: "delete", table: RAW_ID }), /notion\.delete blocked/);
    assert.equal(calls.length, 0);
  });

  it("SHADOW_TARGET form passes validate() but execute() throws (real target required)", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, {})]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    assert.doesNotThrow(() => adapter.validate({ op: "read", table: "notion:databases:12345678" }));
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "notion:databases:12345678" }),
      /SHADOW_TARGET/
    );
    assert.equal(calls.length, 0);
  });

  it("missing token (no opts.token, no env NOTION_TOKEN) throws before any fetch", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(200, {})]);
    const savedEnv = process.env.NOTION_TOKEN;
    delete process.env.NOTION_TOKEN;
    try {
      const adapter = create({ fetch: fetchImpl, _sleep: noSleep });
      await assert.rejects(() => adapter.execute({ op: "read", table: RAW_ID }), /notion token not configured/);
      assert.equal(calls.length, 0);
    } finally {
      if (savedEnv === undefined) delete process.env.NOTION_TOKEN;
      else process.env.NOTION_TOKEN = savedEnv;
    }
  });
});

describe("NotionAdapter.execute — HTTP errors", () => {
  it("4xx error → throws 'notion <status> <code>', no token/body leak in message", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [jsonResponse(400, { code: "validation_error", message: "secret-ish detail" })]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(
      () => adapter.execute({ op: "read", table: RAW_ID, where: { pageId: "page-1" } }),
      (err) => {
        assert.equal(err.message, "notion 400 validation_error");
        assert.equal(err.message.includes(FAKE_TOKEN), false);
        assert.equal(err.message.includes("secret-ish detail"), false);
        return true;
      }
    );
  });

  it("error body missing/unparseable code → 'unknown'", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [
      {
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: async () => {
          throw new Error("not json");
        },
      },
    ]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(
      () => adapter.execute({ op: "read", table: RAW_ID, where: { pageId: "page-1" } }),
      /^Error: notion 500 unknown$/
    );
  });

  it("429 retried once honoring Retry-After, succeeds on 2nd attempt", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const sleeps = [];
    const fetchImpl = fakeFetch(calls, [
      jsonResponse(429, { code: "rate_limited" }, { "Retry-After": "2" }),
      jsonResponse(200, { id: "page-1" }),
    ]);
    const adapter = create({
      token: FAKE_TOKEN,
      fetch: fetchImpl,
      _sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    const result = await adapter.execute({ op: "read", table: RAW_ID, where: { pageId: "page-1" } });

    assert.deepEqual(result, { rows: [{ id: "page-1" }], rowCount: 1 });
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [2000]);
  });

  it("429 twice → throws after single retry (max 1 retry)", async () => {
    const { create } = require(notionPath);
    const calls = [];
    const fetchImpl = fakeFetch(calls, [
      jsonResponse(429, { code: "rate_limited" }, { "Retry-After": "1" }),
      jsonResponse(429, { code: "rate_limited" }, { "Retry-After": "1" }),
    ]);
    const adapter = create({ token: FAKE_TOKEN, fetch: fetchImpl, _sleep: noSleep });

    await assert.rejects(
      () => adapter.execute({ op: "read", table: RAW_ID, where: { pageId: "page-1" } }),
      /notion 429 rate_limited/
    );
    assert.equal(calls.length, 2);
  });
});
