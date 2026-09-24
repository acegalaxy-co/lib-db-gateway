"use strict";
const DEFAULTS = {
    apiVersion: "2022-06-28",
    baseUrl: "https://api.notion.com",
    rateIntervalMs: 360,
    maxRetries: 3,
    timeoutMs: 30000,
    serverErrorDelayMs: 3000,
    networkErrorDelayMs: 5000,
    batchDelayMs: 0,
};
function _envNum(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "")
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
// Resolves a numeric option: explicit option (if a valid finite, non-negative
// number) wins, else env (validated the same way), else fallback. An invalid
// explicit value (NaN, negative, non-number) is NOT used as-is — it falls
// through to env/default rather than producing e.g. a negative retry count.
function _resolveNum(explicit, envName, fallback) {
    if (explicit !== undefined) {
        return typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0 ? explicit : _envNum(envName, fallback);
    }
    return _envNum(envName, fallback);
}
function resolveNotionConfig(partial) {
    const p = partial || {};
    return {
        token: p.token !== undefined ? p.token : process.env.NOTION_TOKEN,
        apiVersion: p.apiVersion || process.env.NOTION_API_VERSION || DEFAULTS.apiVersion,
        baseUrl: p.baseUrl || process.env.NOTION_BASE_URL || DEFAULTS.baseUrl,
        rateIntervalMs: _resolveNum(p.rateIntervalMs, "NOTION_RATE_INTERVAL_MS", DEFAULTS.rateIntervalMs),
        maxRetries: _resolveNum(p.maxRetries, "NOTION_MAX_RETRIES", DEFAULTS.maxRetries),
        timeoutMs: _resolveNum(p.timeoutMs, "NOTION_TIMEOUT_MS", DEFAULTS.timeoutMs),
        serverErrorDelayMs: _resolveNum(p.serverErrorDelayMs, "NOTION_SERVER_ERROR_DELAY_MS", DEFAULTS.serverErrorDelayMs),
        networkErrorDelayMs: _resolveNum(p.networkErrorDelayMs, "NOTION_NETWORK_ERROR_DELAY_MS", DEFAULTS.networkErrorDelayMs),
        batchDelayMs: _resolveNum(p.batchDelayMs, "NOTION_BATCH_DELAY_MS", DEFAULTS.batchDelayMs),
        auditDir: p.auditDir !== undefined ? p.auditDir : process.env.NOTION_CLIENT_AUDIT_DIR,
        limiter: p.limiter,
        hooks: p.hooks,
        callerSkip: p.callerSkip || [],
    };
}
module.exports = { resolveNotionConfig, DEFAULTS };
