interface AuditLoggerHandle {
    record: (rec: Record<string, unknown>) => Promise<void>;
    LOG_PATH: string;
}
/**
 * Resolve the audit log path: explicit override → env DB_GATEWAY_AUDIT_LOG_PATH →
 * process.cwd()/logs/db-gateway-audit.log. Never __dirname (must never write inside
 * node_modules of a consuming project).
 */
declare function resolveLogPath(explicit?: string): string;
/**
 * Create an audit logger instance for a given (or default-resolved) log path.
 * mkdir -p's the containing directory so first write never fails on missing dir.
 */
declare function createLogger(explicitPath?: string): AuditLoggerHandle;
declare const _default: {
    createLogger: typeof createLogger;
    resolveLogPath: typeof resolveLogPath;
};
export = _default;
