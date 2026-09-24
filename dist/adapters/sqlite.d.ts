declare const IDBAdapter: any;
interface SqliteAdapterOptions {
    dbPath?: string;
}
declare class SqliteAdapter extends IDBAdapter {
    private _opts;
    constructor(opts?: SqliteAdapterOptions);
    get store(): string;
    validate(request: {
        table?: string;
    } | null | undefined): void;
    execute(_request: unknown): Promise<{
        rows?: unknown[];
        rowCount?: number;
    }>;
}
declare function create(opts?: SqliteAdapterOptions): SqliteAdapter;
declare const _default: {
    SqliteAdapter: typeof SqliteAdapter;
    create: typeof create;
};
export = _default;
