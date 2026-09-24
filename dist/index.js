"use strict";
const { resolveCaller } = require("./identity/resolver");
const authz = require("./authz/engine");
const rateLimitModule = require("./rate-limit/limiter");
const auditModule = require("./audit/logger");
const { IDBAdapter } = require("./adapters/adapter-interface");
function _nowIso() {
    return new Date().toISOString();
}
function _resolveAdapter(store, val) {
    // An object already implementing execute() is used as-is (test injection / pre-built adapter).
    if (val && typeof val.execute === "function")
        return val;
    const opts = val && typeof val === "object" ? val : {};
    switch (store) {
        case "notion":
            return require("./adapters/notion").create(opts);
        case "postgres":
            return require("./adapters/postgres").create(opts);
        case "sqlite":
            return require("./adapters/sqlite").create(opts);
        default:
            return null;
    }
}
/**
 * Create a DB gateway instance. See types.ts DbGatewayOptions for full contract.
 * A store is only usable if explicitly configured in opts.adapters — an unconfigured
 * store (even a valid store name) denies L1_adapter.
 */
function createDbGateway(opts = {}) {
    const dryRun = !!opts.dryRun;
    const policies = opts.policies;
    // No rateLimitPerMinute override → let createLimiter() fall back to its own
    // default, which reads DB_GATEWAY_QPS_PER_MIN at call time (not module-load time).
    const limiter = opts.rateLimitPerMinute
        ? rateLimitModule.createLimiter(opts.rateLimitPerMinute)
        : rateLimitModule.createLimiter();
    const auditLogger = auditModule.createLogger(opts.auditLogPath);
    const adapters = new Map();
    if (opts.adapters) {
        for (const store of Object.keys(opts.adapters)) {
            const inst = _resolveAdapter(store, opts.adapters[store]);
            if (inst)
                adapters.set(store, inst);
        }
    }
    async function _finalize(outcome, started) {
        outcome.latencyMs = Date.now() - started;
        try {
            await auditLogger.record(outcome);
        }
        catch (_e) {
            // swallowed — audit must never break the main flow.
        }
        return {
            outcome: outcome.outcome,
            denyReason: outcome.denyReason,
            latencyMs: outcome.latencyMs,
        };
    }
    /**
     * Dispatch a DB query through all layers (identity, schema/authz, policy, rate-limit,
     * adapter). Never throws — returns outcome + denyReason + rows/latency.
     * dryRun: runs L2-L4 + adapter.validate() only, no I/O, rowCount null.
     */
    async function query(request, caller) {
        const started = Date.now();
        const outcome = {
            ts: _nowIso(),
            store: request && request.store,
            op: request && request.op,
            table: request && request.table,
            callerService: (caller && caller.service) || "",
            callerScope: (caller && caller.scope) || "",
            outcome: "deny",
            denyReason: null,
            latencyMs: 0,
        };
        try {
            // L2 — Identity (default-deny)
            const resolved = await resolveCaller(caller);
            if (!resolved) {
                outcome.denyReason = "L2_unknown_caller";
                return await _finalize(outcome, started);
            }
            // L3 — Schema contract + baseline authz (default-deny)
            const authzResult = await authz.check(resolved, request);
            if (!authzResult.allow) {
                outcome.denyReason = authzResult.reason || "L3_authz";
                return await _finalize(outcome, started);
            }
            // L3 — Per-service policy ACL, only when opts.policies configured.
            if (policies) {
                const policyResult = authz.checkPolicy(policies, resolved, request);
                if (!policyResult.allow) {
                    outcome.denyReason = policyResult.reason || "L3_policy";
                    return await _finalize(outcome, started);
                }
            }
            // L4 — Rate limit
            const rateOk = await limiter.check(resolved.service, request.store);
            if (!rateOk) {
                outcome.denyReason = "L4_rate_limit";
                return await _finalize(outcome, started);
            }
            // L1 — Adapter (must be explicitly configured)
            const adapter = adapters.get(request.store);
            if (!adapter) {
                outcome.denyReason = "L1_adapter";
                return await _finalize(outcome, started);
            }
            if (dryRun) {
                if (typeof adapter.validate === "function") {
                    await adapter.validate(request);
                }
                outcome.outcome = "allow";
                outcome.denyReason = null;
                outcome.rowCount = null;
                const finalized = await _finalize(outcome, started);
                return { ...finalized, rowCount: null };
            }
            const result = await adapter.execute(request);
            outcome.outcome = "allow";
            outcome.denyReason = null;
            outcome.rowCount = result && result.rowCount;
            const finalized = await _finalize(outcome, started);
            return { ...finalized, rows: result.rows, rowCount: result.rowCount };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : undefined;
            // Stub adapters throw "not implemented" — expected during Phase 1 rollout.
            // Log fatal only for unexpected errors so audit/consumer logs stay clean.
            if (!msg || !/not implemented \(Phase 1 stub\)/.test(msg)) {
                // eslint-disable-next-line no-console
                console.error("[db-gateway] query fatal:", msg);
            }
            outcome.denyReason = outcome.denyReason || "L1_adapter";
            return await _finalize(outcome, started);
        }
    }
    return { query };
}
// Legacy module-level query = lazily created default instance.
// dryRun:true + notion-only adapter preserves the historical shadow-mode semantics
// exactly: never performs real I/O, only validates (target regex + delete block).
let _defaultGateway = null;
function _getDefaultGateway() {
    if (!_defaultGateway) {
        _defaultGateway = createDbGateway({ dryRun: true, adapters: { notion: {} } });
    }
    return _defaultGateway;
}
async function query(request, caller) {
    return _getDefaultGateway().query(request, caller);
}
module.exports = { createDbGateway, query, IDBAdapter };
