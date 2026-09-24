"use strict";
const { IDBAdapter } = require("./adapter-interface");
// table / column identifiers: snake_case, optional single-dot-qualified (schema.table).
const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
function quoteIdent(name) {
    return name
        .split(".")
        .map((part) => `"${part}"`)
        .join(".");
}
// Builds `col = $n` / `col IS NULL` / `col = ANY($n)` clauses for every where key except
// the reserved "$limit" (handled separately by callers that support it). Pushes param
// values onto `params` in place, matching each generated placeholder index.
function buildWhereClauses(where, params) {
    const clauses = [];
    if (!where || typeof where !== "object")
        return clauses;
    for (const key of Object.keys(where)) {
        if (key === "$limit")
            continue;
        const val = where[key];
        if (val === null) {
            clauses.push(`${quoteIdent(key)} IS NULL`);
        }
        else if (Array.isArray(val)) {
            params.push(val);
            clauses.push(`${quoteIdent(key)} = ANY($${params.length})`);
        }
        else {
            params.push(val);
            clauses.push(`${quoteIdent(key)} = $${params.length}`);
        }
    }
    return clauses;
}
class PostgresAdapter extends IDBAdapter {
    _opts;
    _pool;
    constructor(opts = {}) {
        super();
        this._opts = opts;
    }
    get store() {
        return "postgres";
    }
    /**
     * Validate a request without I/O. Throws on invalid request.
     * Checks table + column identifiers against the allowlisted identifier shape
     * (defence against SQL injection via identifiers, which cannot be parameterized).
     * Single source of truth for identifier validation — execute() calls it too.
     */
    validate(request) {
        const table = request && request.table;
        if (typeof table !== "string" || !IDENTIFIER_REGEX.test(table)) {
            throw new Error("PostgresAdapter: invalid table identifier");
        }
        if (request && Array.isArray(request.columns)) {
            for (const col of request.columns) {
                if (typeof col !== "string" || !IDENTIFIER_REGEX.test(col)) {
                    throw new Error("PostgresAdapter: invalid column identifier");
                }
            }
        }
        if (request && request.where && typeof request.where === "object") {
            for (const key of Object.keys(request.where)) {
                if (key === "$limit")
                    continue;
                if (key.startsWith("$") || !IDENTIFIER_REGEX.test(key)) {
                    throw new Error("PostgresAdapter: invalid where identifier");
                }
            }
        }
        if (request && request.data && typeof request.data === "object") {
            for (const key of Object.keys(request.data)) {
                if (!IDENTIFIER_REGEX.test(key)) {
                    throw new Error("PostgresAdapter: invalid column identifier");
                }
            }
        }
        const archiveColumn = this._opts.archiveColumn || "archived_at";
        if (!IDENTIFIER_REGEX.test(archiveColumn)) {
            throw new Error("PostgresAdapter: invalid archiveColumn identifier");
        }
    }
    async _getPool() {
        if (this._opts.pool)
            return this._opts.pool;
        if (this._pool)
            return this._pool;
        if (!this._opts.connectionString) {
            throw new Error("PostgresAdapter: postgres not configured");
        }
        let pgModule;
        try {
            pgModule = require("pg");
        }
        catch (_e) {
            throw new Error("PostgresAdapter: pg not installed");
        }
        this._pool = new pgModule.Pool({ connectionString: this._opts.connectionString });
        return this._pool;
    }
    async _read(pool, request) {
        const cols = Array.isArray(request.columns) && request.columns.length ? request.columns.map(quoteIdent).join(", ") : "*";
        const params = [];
        const clauses = buildWhereClauses(request.where, params);
        let sql = `SELECT ${cols} FROM ${quoteIdent(request.table)}`;
        if (clauses.length)
            sql += ` WHERE ${clauses.join(" AND ")}`;
        const where = request.where || {};
        if (Object.prototype.hasOwnProperty.call(where, "$limit")) {
            const limit = where["$limit"];
            if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
                throw new Error("PostgresAdapter: invalid $limit value");
            }
            params.push(limit);
            sql += ` LIMIT $${params.length}`;
        }
        const res = await pool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount === null ? undefined : res.rowCount };
    }
    async _insert(pool, table, data) {
        if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
            throw new Error("PostgresAdapter: create/write requires non-empty data");
        }
        const keys = Object.keys(data);
        const cols = keys.map(quoteIdent).join(", ");
        const params = keys.map((k) => data[k]);
        const placeholders = keys.map((_k, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders}) RETURNING *`;
        const res = await pool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount === null ? undefined : res.rowCount };
    }
    async _update(pool, table, data, where) {
        if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
            throw new Error("PostgresAdapter: update requires non-empty data");
        }
        const params = [];
        const setClauses = Object.keys(data).map((k) => {
            params.push(data[k]);
            return `${quoteIdent(k)} = $${params.length}`;
        });
        const whereClauses = buildWhereClauses(where, params);
        if (whereClauses.length === 0) {
            throw new Error("PostgresAdapter: update requires non-empty where");
        }
        const sql = `UPDATE ${quoteIdent(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;
        const res = await pool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount === null ? undefined : res.rowCount };
    }
    async _archive(pool, table, where) {
        const archiveColumn = this._opts.archiveColumn || "archived_at";
        const params = [];
        const whereClauses = buildWhereClauses(where, params);
        if (whereClauses.length === 0) {
            throw new Error("PostgresAdapter: archive requires non-empty where");
        }
        const sql = `UPDATE ${quoteIdent(table)} SET ${quoteIdent(archiveColumn)} = now() WHERE ${whereClauses.join(" AND ")} RETURNING *`;
        const res = await pool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount === null ? undefined : res.rowCount };
    }
    async execute(request) {
        const req = request;
        this.validate(req);
        if (req && req.rawSql) {
            throw new Error("PostgresAdapter: rawSql denied");
        }
        const pool = await this._getPool();
        const op = req && req.op;
        switch (op) {
            case "read":
                return this._read(pool, req);
            case "create":
            case "write":
                return this._insert(pool, req.table, req && req.data);
            case "update":
                return this._update(pool, req.table, req && req.data, req && req.where);
            case "archive":
                return this._archive(pool, req.table, req && req.where);
            case "delete":
                throw new Error("PostgresAdapter: delete denied");
            default:
                throw new Error(`PostgresAdapter: unsupported op '${String(op)}'`);
        }
    }
}
function create(opts = {}) {
    return new PostgresAdapter(opts);
}
module.exports = { PostgresAdapter, create };
