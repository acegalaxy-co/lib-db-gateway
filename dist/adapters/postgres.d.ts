declare const IDBAdapter: any;
interface PgQueryResult {
    rows: unknown[];
    rowCount: number | null;
}
interface PgPool {
    query(text: string, params?: unknown[]): Promise<PgQueryResult>;
}
interface PostgresAdapterOptions {
    pool?: PgPool;
    connectionString?: string;
    archiveColumn?: string;
}
declare class PostgresAdapter extends IDBAdapter {
    private _opts;
    private _pool?;
    constructor(opts?: PostgresAdapterOptions);
    get store(): string;
    /**
     * Validate a request without I/O. Throws on invalid request.
     * Checks table + column identifiers against the allowlisted identifier shape
     * (defence against SQL injection via identifiers, which cannot be parameterized).
     * Single source of truth for identifier validation — execute() calls it too.
     */
    validate(request: {
        table?: string;
        columns?: string[];
        where?: Record<string, unknown>;
        data?: Record<string, unknown>;
    } | null | undefined): void;
    private _getPool;
    private _read;
    private _insert;
    private _update;
    private _archive;
    execute(request: unknown): Promise<{
        rows?: unknown[];
        rowCount?: number;
    }>;
}
declare function create(opts?: PostgresAdapterOptions): PostgresAdapter;
declare const _default: {
    PostgresAdapter: typeof PostgresAdapter;
    create: typeof create;
};
export = _default;
