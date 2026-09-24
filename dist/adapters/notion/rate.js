"use strict";
/**
 * Proactive rate limiter — token bucket, single shared budget per instance so
 * concurrent callers don't burst past `intervalMs` spacing.
 *
 * Deliberately NOT `rate-limit/limiter.ts` (the gateway's L4 sliding-window
 * QPS-cap that denies requests over a per-minute budget). This is a
 * pre-request pacing primitive for the Notion REST rate limit (~3 req/s) —
 * different algorithm, different job — so it stays local to the adapter.
 */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function createRateLimiter(opts) {
    const intervalMs = (opts && opts.intervalMs) || 0;
    let _nextSlotAt = 0;
    return {
        async acquire() {
            const now = Date.now();
            if (_nextSlotAt <= now) {
                _nextSlotAt = now + intervalMs;
                return;
            }
            const waitMs = _nextSlotAt - now;
            _nextSlotAt += intervalMs;
            await sleep(waitMs);
        },
    };
}
module.exports = { createRateLimiter };
