interface RateLimiter {
    acquire(): Promise<void>;
}
declare function createRateLimiter(opts: {
    intervalMs: number;
}): RateLimiter;
declare const _default: {
    createRateLimiter: typeof createRateLimiter;
};
export = _default;
