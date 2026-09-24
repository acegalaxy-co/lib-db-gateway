"use strict";
const fs = require("fs");
const path = require("path");
const { createAuditLogger } = require("@acegalaxy/lib-security-utils/audit-log");
/**
 * Resolve the audit log path: explicit override → env DB_GATEWAY_AUDIT_LOG_PATH →
 * process.cwd()/logs/db-gateway-audit.log. Never __dirname (must never write inside
 * node_modules of a consuming project).
 */
function resolveLogPath(explicit) {
    return explicit || process.env.DB_GATEWAY_AUDIT_LOG_PATH || path.join(process.cwd(), "logs", "db-gateway-audit.log");
}
/**
 * Create an audit logger instance for a given (or default-resolved) log path.
 * mkdir -p's the containing directory so first write never fails on missing dir.
 */
function createLogger(explicitPath) {
    const logPath = resolveLogPath(explicitPath);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    return createAuditLogger({ logPath, tag: "db-gateway audit", mode: "sync" });
}
module.exports = { createLogger, resolveLogPath };
