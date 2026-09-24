"use strict";
const { IDBAdapter } = require("./adapter-interface");
const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;
class SqliteAdapter extends IDBAdapter {
    _opts;
    constructor(opts = {}) {
        super();
        this._opts = opts;
    }
    get store() {
        return "sqlite";
    }
    validate(request) {
        const table = request && request.table;
        if (typeof table !== "string" || !IDENTIFIER_REGEX.test(table)) {
            throw new Error("SqliteAdapter: invalid table identifier");
        }
    }
    async execute(_request) {
        // TODO: open db file per DB_GATEWAY_SQLITE_PATH env / opts.dbPath, run prepared stmt.
        throw new Error("SqliteAdapter.execute not implemented (Phase 1 stub)");
    }
}
function create(opts = {}) {
    return new SqliteAdapter(opts);
}
module.exports = { SqliteAdapter, create };
