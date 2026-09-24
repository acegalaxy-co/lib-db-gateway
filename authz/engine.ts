"use strict";

const NAMING_REGEX = /^[a-z][a-z0-9_]*$/; // snake_case enforcement

/**
 * Check a QueryRequest against schema + baseline authz (Phase 1 — no per-table ACL).
 * Per-service ACL is layered separately by createDbGateway() when opts.policies is set
 * (see checkPolicy below / index.ts L3_policy).
 */
async function check(
  caller: import("../types").Caller,
  request: import("../types").QueryRequest
): Promise<{ allow: boolean; reason?: string }> {
  if (!request || !request.store || !request.op || !request.table) {
    return { allow: false, reason: "L3_schema" };
  }

  // Naming convention — applies to postgres + sqlite. Notion uses database_id (UUID).
  if (request.store !== "notion" && !NAMING_REGEX.test(request.table)) {
    return { allow: false, reason: "L3_schema" };
  }
  if (Array.isArray(request.columns)) {
    for (const col of request.columns) {
      if (!NAMING_REGEX.test(col)) return { allow: false, reason: "L3_schema" };
    }
  }

  // Notion hard-block on delete. Archive (op=archive, or op=update with data.archived=true) OK.
  if (request.store === "notion" && request.op === "delete") {
    return { allow: false, reason: "L3_notion_delete" };
  }

  return { allow: true };
}

/**
 * Per-service policy ACL (only run when createDbGateway() is given opts.policies).
 * Default-deny: caller.service must have an entry. Each of stores/ops/tables is
 * matched against the entry's allowlist ("*" wildcard); an omitted dimension is
 * treated as unrestricted for that axis.
 */
function checkPolicy(
  policies: Record<string, { stores?: string[]; ops?: string[]; tables?: string[] }>,
  caller: import("../types").Caller,
  request: import("../types").QueryRequest
): { allow: boolean; reason?: string } {
  const entry = policies && caller && policies[caller.service];
  if (!entry) return { allow: false, reason: "L3_policy" };

  const dims: Array<[string[] | undefined, string]> = [
    [entry.stores, request.store],
    [entry.ops, request.op],
    [entry.tables, request.table],
  ];
  for (const [allowlist, value] of dims) {
    if (!allowlist) continue; // omitted dimension = unrestricted
    if (!allowlist.includes("*") && !allowlist.includes(value)) {
      return { allow: false, reason: "L3_policy" };
    }
  }
  return { allow: true };
}

export = { check, checkPolicy };
