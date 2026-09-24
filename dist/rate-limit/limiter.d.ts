interface Limiter {
    check(service: string, store: string): Promise<boolean>;
}
/**
 * Create an independent sliding-window limiter instance (used by createDbGateway()
 * so each factory instance gets its own bucket, not the shared module-level one).
 */
declare function createLimiter(maxReq?: number): Limiter;
/**
 * @param service - The service name
 * @param store - The store identifier
 * @returns Backward-compat boolean (module-level shared limiter).
 */
declare function check(service: string, store: string): Promise<boolean>;
declare const _default_1: {
    check: typeof check;
    WINDOW_MS: number;
    readonly MAX_REQUESTS: number;
    createLimiter: typeof createLimiter;
};
export = _default_1;
