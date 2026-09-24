/**
 * @typedef {Object} Caller
 * @property {string} service    service name (e.g. "nexus-invoice-collector")
 * @property {string} scope      scope identifier (e.g. "nexus", "framework", "devops")
 * @property {string[]} [roles]  optional role list for authz
 */
export interface Caller {
    service: string;
    scope: string;
    roles?: string[];
}
/**
 * @typedef {Object} QueryRequest
 * @property {"postgres"|"sqlite"|"notion"} store  target data store
 * @property {"read"|"write"|"archive"|"create"|"update"} op  operation type
 * @property {string} table          table name (postgres/sqlite) or database_id (notion)
 * @property {string[]} [columns]    columns touched (for schema validation)
 * @property {Object} [where]        filter predicate
 * @property {Object} [data]         payload for write/create/update
 * @property {string} [rawSql]       raw SQL (only for allowlisted services)
 */
export interface QueryRequest {
    store: "postgres" | "sqlite" | "notion";
    op: "read" | "write" | "archive" | "create" | "update" | "delete";
    table: string;
    columns?: string[];
    where?: Record<string, unknown>;
    data?: Record<string, unknown>;
    rawSql?: string;
}
/**
 * @typedef {Object} OutcomeRecord
 * @property {string} ts              ISO timestamp
 * @property {string} store
 * @property {string} op
 * @property {string} table
 * @property {string} callerService
 * @property {string} callerScope
 * @property {"allow"|"deny"} outcome
 * @property {string|null} denyReason "L2_unknown_caller" | "L3_schema" | "L3_authz" |
 *                                     "L3_notion_delete" | "L3_policy" | "L4_rate_limit" | "L1_adapter"
 * @property {number} latencyMs
 * @property {number|null} [rowCount] rows affected (on allow); null in dryRun
 */
export interface OutcomeRecord {
    ts: string;
    store: string;
    op: string;
    table: string;
    callerService: string;
    callerScope: string;
    outcome: "allow" | "deny";
    denyReason: "L2_unknown_caller" | "L3_schema" | "L3_authz" | "L3_notion_delete" | "L3_policy" | "L4_rate_limit" | "L1_adapter" | null;
    latencyMs: number;
    rowCount?: number | null;
}
/**
 * @typedef {Object} QueryResult
 * @property {"allow"|"deny"} outcome
 * @property {string|null} denyReason
 * @property {unknown[]} [rows]
 * @property {number|null} [rowCount]
 * @property {number} latencyMs
 */
export interface QueryResult {
    outcome: "allow" | "deny";
    denyReason: string | null;
    rows?: unknown[];
    rowCount?: number | null;
    latencyMs: number;
}
/**
 * @typedef {Object} PolicyEntry
 * @property {string[]} [stores]  allowed stores for this service ("*" wildcard); absent = unrestricted
 * @property {string[]} [ops]     allowed ops for this service ("*" wildcard); absent = unrestricted
 * @property {string[]} [tables]  allowed tables for this service ("*" wildcard); absent = unrestricted
 */
export interface PolicyEntry {
    stores?: string[];
    ops?: string[];
    tables?: string[];
}
/**
 * @typedef {Object} DbGatewayOptions
 * @property {Object} [adapters]           per-store adapter options object or pre-built IDBAdapter instance
 * @property {Object.<string, PolicyEntry>} [policies]  absent → legacy (schema-only) behavior;
 *                                          present → default-deny per caller.service
 * @property {string} [auditLogPath]       default env DB_GATEWAY_AUDIT_LOG_PATH → cwd/logs/db-gateway-audit.log
 * @property {number} [rateLimitPerMinute] default env DB_GATEWAY_QPS_PER_MIN → 30
 * @property {boolean} [dryRun]            true → L2-L4 + adapter.validate() only, no I/O, rowCount null
 */
export interface DbGatewayOptions {
    adapters?: {
        notion?: Record<string, unknown> | {
            store: string;
            execute: Function;
            validate?: Function;
        };
        postgres?: Record<string, unknown> | {
            store: string;
            execute: Function;
            validate?: Function;
        };
        sqlite?: Record<string, unknown> | {
            store: string;
            execute: Function;
            validate?: Function;
        };
    };
    policies?: Record<string, PolicyEntry>;
    auditLogPath?: string;
    rateLimitPerMinute?: number;
    dryRun?: boolean;
}
