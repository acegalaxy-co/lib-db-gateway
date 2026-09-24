"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const postgresPath = path.resolve(__dirname, "../dist/adapters/postgres");

function makeMockPool(result) {
  const calls = [];
  const pool = {
    query: async (text, params) => {
      calls.push({ text, params });
      return result || { rows: [], rowCount: 0 };
    },
  };
  return { pool, calls };
}

describe("PostgresAdapter.execute() — read", () => {
  it("builds SELECT * with no where", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool({ rows: [{ id: 1 }], rowCount: 1 });
    const adapter = create({ pool });
    const res = await adapter.execute({ op: "read", table: "users" });
    assert.equal(calls[0].text, 'SELECT * FROM "users"');
    assert.deepEqual(calls[0].params, []);
    assert.deepEqual(res.rows, [{ id: 1 }]);
    assert.equal(res.rowCount, 1);
  });

  it("builds SELECT with requested columns", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool });
    await adapter.execute({ op: "read", table: "users", columns: ["id", "email"] });
    assert.equal(calls[0].text, 'SELECT "id", "email" FROM "users"');
  });

  it("builds WHERE with scalar, null, array values", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool });
    await adapter.execute({
      op: "read",
      table: "users",
      where: { id: 5, deleted_at: null, role: ["admin", "owner"] },
    });
    assert.equal(
      calls[0].text,
      'SELECT * FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL AND "role" = ANY($2)'
    );
    assert.deepEqual(calls[0].params, [5, ["admin", "owner"]]);
  });

  it("applies $limit as a parameterized LIMIT clause", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool });
    await adapter.execute({ op: "read", table: "users", where: { id: 5, $limit: 10 } });
    assert.equal(calls[0].text, 'SELECT * FROM "users" WHERE "id" = $1 LIMIT $2');
    assert.deepEqual(calls[0].params, [5, 10]);
  });

  it("rejects $limit that is not a positive integer", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", where: { $limit: 0 } }),
      /invalid \$limit value/
    );
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", where: { $limit: "10" } }),
      /invalid \$limit value/
    );
  });

  it("rejects a $-prefixed where key other than $limit", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", where: { $gt: 5 } }),
      /invalid where identifier/
    );
  });
});

describe("PostgresAdapter.execute() — create/write", () => {
  it("builds parameterized INSERT ... RETURNING *", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool({ rows: [{ id: 1, name: "a" }], rowCount: 1 });
    const adapter = create({ pool });
    const res = await adapter.execute({ op: "create", table: "users", data: { name: "a", email: "a@b.c" } });
    assert.equal(calls[0].text, 'INSERT INTO "users" ("name", "email") VALUES ($1, $2) RETURNING *');
    assert.deepEqual(calls[0].params, ["a", "a@b.c"]);
    assert.deepEqual(res.rows, [{ id: 1, name: "a" }]);
  });

  it("write op behaves the same as create", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool });
    await adapter.execute({ op: "write", table: "users", data: { name: "a" } });
    assert.equal(calls[0].text, 'INSERT INTO "users" ("name") VALUES ($1) RETURNING *');
  });

  it("throws on empty data", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "create", table: "users", data: {} }),
      /requires non-empty data/
    );
    await assert.rejects(() => adapter.execute({ op: "create", table: "users" }), /requires non-empty data/);
  });
});

describe("PostgresAdapter.execute() — update", () => {
  it("builds parameterized UPDATE ... WHERE ... RETURNING *", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool({ rows: [{ id: 1 }], rowCount: 1 });
    const adapter = create({ pool });
    await adapter.execute({ op: "update", table: "users", data: { name: "b" }, where: { id: 1 } });
    assert.equal(calls[0].text, 'UPDATE "users" SET "name" = $1 WHERE "id" = $2 RETURNING *');
    assert.deepEqual(calls[0].params, ["b", 1]);
  });

  it("throws on empty data", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "update", table: "users", data: {}, where: { id: 1 } }),
      /update requires non-empty data/
    );
  });

  it("throws on empty where", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "update", table: "users", data: { name: "b" }, where: {} }),
      /update requires non-empty where/
    );
    await assert.rejects(
      () => adapter.execute({ op: "update", table: "users", data: { name: "b" } }),
      /update requires non-empty where/
    );
  });
});

describe("PostgresAdapter.execute() — archive", () => {
  it("builds UPDATE ... SET archived_at = now() ... RETURNING *", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool({ rows: [{ id: 1 }], rowCount: 1 });
    const adapter = create({ pool });
    await adapter.execute({ op: "archive", table: "users", where: { id: 1 } });
    assert.equal(calls[0].text, 'UPDATE "users" SET "archived_at" = now() WHERE "id" = $1 RETURNING *');
    assert.deepEqual(calls[0].params, [1]);
  });

  it("uses a custom archiveColumn when configured", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool, archiveColumn: "removed_at" });
    await adapter.execute({ op: "archive", table: "users", where: { id: 1 } });
    assert.equal(calls[0].text, 'UPDATE "users" SET "removed_at" = now() WHERE "id" = $1 RETURNING *');
  });

  it("throws on empty where", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "archive", table: "users", where: {} }),
      /archive requires non-empty where/
    );
  });
});

describe("PostgresAdapter.execute() — denied ops", () => {
  it("denies delete", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(() => adapter.execute({ op: "delete", table: "users", where: { id: 1 } }), /delete denied/);
  });

  it("denies rawSql regardless of op", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", rawSql: "SELECT 1" }),
      /rawSql denied/
    );
  });
});

describe("PostgresAdapter.execute() — identifier injection guards", () => {
  it("rejects an unsafe table identifier", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users; drop table users;--" }),
      /invalid table identifier/
    );
  });

  it("rejects an unsafe column identifier", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", columns: ['"x"'] }),
      /invalid column identifier/
    );
  });

  it("rejects an unsafe where key", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "read", table: "users", where: { A: 1 } }),
      /invalid where identifier/
    );
  });

  it("rejects a data key that is not a valid identifier", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool });
    await assert.rejects(
      () => adapter.execute({ op: "create", table: "users", data: { "a.b.c": 1 } }),
      /invalid column identifier/
    );
  });

  it("allows a single schema-qualified identifier (schema.table)", async () => {
    const { create } = require(postgresPath);
    const { pool, calls } = makeMockPool();
    const adapter = create({ pool });
    await adapter.execute({ op: "read", table: "public.users" });
    assert.equal(calls[0].text, 'SELECT * FROM "public"."users"');
  });

  it("rejects an unsafe archiveColumn identifier", async () => {
    const { create } = require(postgresPath);
    const { pool } = makeMockPool();
    const adapter = create({ pool, archiveColumn: "removed; drop table users;--" });
    await assert.rejects(
      () => adapter.execute({ op: "archive", table: "users", where: { id: 1 } }),
      /invalid archiveColumn identifier/
    );
  });
});

describe("PostgresAdapter.execute() — configuration", () => {
  it("throws when neither pool nor connectionString is configured", async () => {
    const { create } = require(postgresPath);
    const adapter = create();
    await assert.rejects(() => adapter.execute({ op: "read", table: "users" }), /postgres not configured/);
  });
});

describe("PostgresAdapter — integration (real Postgres, skipped unless PG_TEST_URL set)", () => {
  it(
    "round-trips create/read/update/archive against a live database",
    { skip: !process.env.PG_TEST_URL },
    async () => {
      const { create } = require(postgresPath);
      const adapter = create({ connectionString: process.env.PG_TEST_URL });
      const created = await adapter.execute({
        op: "create",
        table: "db_gateway_pg_adapter_test",
        data: { label: "postgres-adapter-integration-test" },
      });
      assert.ok(created.rows[0].id);
      const id = created.rows[0].id;

      const read = await adapter.execute({
        op: "read",
        table: "db_gateway_pg_adapter_test",
        where: { id },
      });
      assert.equal(read.rows.length, 1);

      const updated = await adapter.execute({
        op: "update",
        table: "db_gateway_pg_adapter_test",
        data: { label: "updated" },
        where: { id },
      });
      assert.equal(updated.rows[0].label, "updated");

      const archived = await adapter.execute({
        op: "archive",
        table: "db_gateway_pg_adapter_test",
        where: { id },
      });
      assert.ok(archived.rows[0].archived_at);
    }
  );
});
