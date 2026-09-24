declare const IDBAdapter: any;
interface NotionAdapterOptions {
    token?: string;
    notionVersion?: string;
    fetch?: typeof fetch;
    baseUrl?: string;
    _sleep?: (ms: number) => Promise<void>;
}
declare class NotionAdapter extends IDBAdapter {
    private _opts;
    constructor(opts?: NotionAdapterOptions);
    get store(): string;
    /**
     * Validate a request without I/O. Throws on invalid request.
     * - delete is hard-blocked (defence in depth, mirrors authz L3_notion_delete).
     * - table must be a raw Notion id or a SHADOW_TARGET form.
     */
    validate(request: {
        op?: string;
        table?: string;
    } | null | undefined): void;
    private _fetchWithRetry;
    private _requestJson;
    execute(request: {
        op?: string;
        table?: string;
        where?: {
            pageId?: string;
            filter?: unknown;
            sorts?: unknown;
            pageSize?: number;
            startCursor?: string;
        };
        data?: Record<string, unknown>;
    } | null | undefined): Promise<{
        rows?: unknown[];
        rowCount?: number;
    }>;
}
declare function create(opts?: NotionAdapterOptions): NotionAdapter;
declare const _default: {
    NotionAdapter: typeof NotionAdapter;
    create: typeof create;
};
export = _default;
