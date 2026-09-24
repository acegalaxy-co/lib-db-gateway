"use strict";

const { createSlidingWindow } = require("@acegalaxy/lib-security-utils/rate-limit");

const WINDOW_MS: number = 60 * 1000;
const DEFAULT_MAX_REQUESTS: number = 30;

// Read lazily (not baked in at module-load time) so a process that sets
// DB_GATEWAY_QPS_PER_MIN before creating a gateway instance is respected,
// even if this module was already require()'d earlier in the same process.
function maxRequests(): number {
  return Number(process.env.DB_GATEWAY_QPS_PER_MIN || DEFAULT_MAX_REQUESTS);
}

function _keyFn(service: string, store: string): string {
  return service ? `${service}::${store || "*"}` : "";
}

interface Limiter {
  check(service: string, store: string): Promise<boolean>;
}

/**
 * Create an independent sliding-window limiter instance (used by createDbGateway()
 * so each factory instance gets its own bucket, not the shared module-level one).
 */
function createLimiter(maxReq: number = maxRequests()): Limiter {
  const limiter = createSlidingWindow({
    windowMs: WINDOW_MS,
    maxRequests: maxReq,
    keyFn: _keyFn,
    reasonOnDeny: "L4_rate_limit",
  });
  return {
    async check(service: string, store: string): Promise<boolean> {
      const result = await limiter.check(service, store);
      return result.ok;
    },
  };
}

const _default = createLimiter(maxRequests());

/**
 * @param service - The service name
 * @param store - The store identifier
 * @returns Backward-compat boolean (module-level shared limiter).
 */
async function check(service: string, store: string): Promise<boolean> {
  return _default.check(service, store);
}

export = {
  check,
  WINDOW_MS,
  // Lazy getter (not a baked-in const) so callers that read MAX_REQUESTS
  // after setting DB_GATEWAY_QPS_PER_MIN at runtime see the current value.
  get MAX_REQUESTS(): number {
    return maxRequests();
  },
  createLimiter,
};
