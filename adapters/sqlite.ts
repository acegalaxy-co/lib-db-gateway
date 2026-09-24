"use strict";
const { IDBAdapter } = require("./adapter-interface");

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;

interface SqliteAdapterOptions {
  dbPath?: string;
}

class SqliteAdapter extends IDBAdapter {
  private _opts: SqliteAdapterOptions;

  constructor(opts: SqliteAdapterOptions = {}) {
    super();
    this._opts = opts;
  }

  get store(): string {
    return "sqlite";
  }

  validate(request: { table?: string } | null | undefined): void {
    const table = request && request.table;
    if (typeof table !== "string" || !IDENTIFIER_REGEX.test(table)) {
      throw new Error("SqliteAdapter: invalid table identifier");
    }
  }

  async execute(_request: unknown): Promise<{ rows?: unknown[]; rowCount?: number }> {
    // TODO: open db file per DB_GATEWAY_SQLITE_PATH env / opts.dbPath, run prepared stmt.
    throw new Error("SqliteAdapter.execute not implemented (Phase 1 stub)");
  }
}

function create(opts: SqliteAdapterOptions = {}): SqliteAdapter {
  return new SqliteAdapter(opts);
}

export = { SqliteAdapter, create };
