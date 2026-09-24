/**
 * Check a QueryRequest against schema + baseline authz (Phase 1 — no per-table ACL).
 * Per-service ACL is layered separately by createDbGateway() when opts.policies is set
 * (see checkPolicy below / index.ts L3_policy).
 */
declare function check(caller: import("../types").Caller, request: import("../types").QueryRequest): Promise<{
    allow: boolean;
    reason?: string;
}>;
/**
 * Per-service policy ACL (only run when createDbGateway() is given opts.policies).
 * Default-deny: caller.service must have an entry. Each of stores/ops/tables is
 * matched against the entry's allowlist ("*" wildcard); an omitted dimension is
 * treated as unrestricted for that axis.
 */
declare function checkPolicy(policies: Record<string, {
    stores?: string[];
    ops?: string[];
    tables?: string[];
}>, caller: import("../types").Caller, request: import("../types").QueryRequest): {
    allow: boolean;
    reason?: string;
};
declare const _default: {
    check: typeof check;
    checkPolicy: typeof checkPolicy;
};
export = _default;
