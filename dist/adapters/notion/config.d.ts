/**
 * Notion transport-client config. Env is read lazily — inside
 * `resolveNotionConfig()`, i.e. at createNotionClient() call time, never at
 * module load — so a process that sets NOTION_* env vars right before
 * creating a client is respected. An explicit option always wins over env.
 */
interface RateLimiterLike {
    acquire(): Promise<void>;
}
interface NotionClientHooks {
    beforeRequest?(url: string, options: any): unknown;
    afterResponse?(ctx: unknown, url: string, options: any, resp: any): void;
}
interface NotionClientConfig {
    token?: string;
    apiVersion?: string;
    baseUrl?: string;
    rateIntervalMs?: number;
    maxRetries?: number;
    timeoutMs?: number;
    serverErrorDelayMs?: number;
    networkErrorDelayMs?: number;
    batchDelayMs?: number;
    auditDir?: string;
    limiter?: RateLimiterLike;
    hooks?: NotionClientHooks;
    callerSkip?: (string | RegExp)[];
}
declare function resolveNotionConfig(partial?: NotionClientConfig): Required<Omit<NotionClientConfig, "token" | "auditDir" | "limiter" | "hooks">> & NotionClientConfig;
declare const _default: {
    resolveNotionConfig: typeof resolveNotionConfig;
    DEFAULTS: {
        apiVersion: string;
        baseUrl: string;
        rateIntervalMs: number;
        maxRetries: number;
        timeoutMs: number;
        serverErrorDelayMs: number;
        networkErrorDelayMs: number;
        batchDelayMs: number;
    };
};
export = _default;
