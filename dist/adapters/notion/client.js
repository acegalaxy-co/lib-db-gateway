"use strict";
/**
 * Notion HTTP client — transport only (rate limiting, retry, mutation audit,
 * beforeRequest/afterResponse hooks). Consumer-specific gating (e.g. an
 * "assert parent db" check) is NOT baked in here — inject it via
 * `hooks.beforeRequest`, which may throw to block the call before any HTTP
 * request is made. Never throws itself — failures return a Response-like
 * object with `ok: false`. `callerSkip` lets a consumer's own shim/wrapper
 * file be skipped too when computing the audit `caller` frame.
 */
const fs = require("fs");
const path = require("path");
const { createAuditLogger } = require("@acegalaxy/lib-security-utils/audit-log");
const { resolveNotionConfig } = require("./config");
const { createRateLimiter } = require("./rate");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
// ── Audit helpers (mutation log) ────────────────────────────────────────
// Mutation = POST (create page/db), PATCH (update/archive), DELETE.
// POST /databases/{id}/query and POST /v1/search are READ — not logged.
function isMutation(method, url) {
    const m = (method || "GET").toUpperCase();
    if (m === "DELETE" || m === "PATCH")
        return true;
    if (m !== "POST")
        return false;
    if (url.endsWith("/query"))
        return false;
    if (url.endsWith("/search"))
        return false;
    return true;
}
function resourceFromUrl(url) {
    const m = url.match(/\/v1\/(pages|databases|blocks|users)\/?([^/?]+)?/);
    if (!m)
        return { type: "unknown" };
    return { type: m[1], id: m[2] || null };
}
function extractSummary(method, body) {
    if (!body || typeof body !== "string")
        return null;
    try {
        const obj = JSON.parse(body);
        if (method === "PATCH") {
            if (obj.properties)
                return { kind: "props-update", fields: Object.keys(obj.properties) };
            if (obj.archived !== undefined)
                return { kind: "archive", archived: obj.archived };
            if (obj.children)
                return { kind: "blocks-append", count: obj.children.length };
        }
        if (method === "POST" && obj.parent) {
            return { kind: "create", parent: Object.keys(obj.parent)[0], hasProps: !!obj.properties };
        }
    }
    catch (_) { /* body not JSON */ }
    return null;
}
function _lineSkipped(line, callerSkip) {
    for (const pattern of callerSkip) {
        if (typeof pattern === "string") {
            if (line.includes(pattern))
                return true;
        }
        else if (pattern instanceof RegExp) {
            if (pattern.test(line))
                return true;
        }
    }
    return false;
}
function callerInfo(callerSkip) {
    const skip = callerSkip || [];
    const stack = (new Error()).stack || "";
    for (const line of stack.split("\n").slice(2)) {
        if (line.includes("/adapters/notion/")
            || line.includes("/node_modules/")
            || _lineSkipped(line, skip))
            continue;
        const m = line.match(/at (?:async )?([^\s(]+)\s*\(?(\/[^)]+)?/);
        if (m) {
            const at = (m[2] || "").split("/").slice(-2).join("/").split(":").slice(0, 2).join(":");
            return { fn: m[1], at };
        }
    }
    return null;
}
// Reuses the lib's shared JSONL audit-log primitive instead of writing fs
// appends by hand — one file per day, matching the original layout.
function auditLog(auditDir, record) {
    if (!auditDir)
        return;
    try {
        if (!fs.existsSync(auditDir))
            fs.mkdirSync(auditDir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10);
        const logPath = path.join(auditDir, `notion-mutations-${day}.jsonl`);
        const logger = createAuditLogger({ logPath, tag: "notion-client audit", mode: "sync" });
        // record() is sync-mode (appendFileSync under the hood) and never throws —
        // fire-and-forget is safe, no need to await.
        logger.record({ ts: new Date().toISOString(), ...record });
    }
    catch (_) { /* never throw from audit */ }
}
function createNotionClient(partialCfg) {
    const cfg = resolveNotionConfig(partialCfg);
    const headers = {
        Authorization: `Bearer ${cfg.token}`,
        "Notion-Version": cfg.apiVersion,
        "Content-Type": "application/json",
    };
    const limiter = cfg.limiter || createRateLimiter({ intervalMs: cfg.rateIntervalMs });
    function _resolveUrl(urlOrPath) {
        if (typeof urlOrPath === "string" && urlOrPath.startsWith("/")) {
            return cfg.baseUrl + urlOrPath;
        }
        return urlOrPath;
    }
    async function request(urlOrPath, options = {}) {
        const url = _resolveUrl(urlOrPath);
        const startTime = Date.now();
        const method = (options.method || "GET").toUpperCase();
        const isMut = isMutation(method, url);
        const auditBase = isMut ? {
            method,
            url,
            resource: resourceFromUrl(url),
            summary: extractSummary(method, options.body),
            caller: callerInfo(cfg.callerSkip),
        } : null;
        // beforeRequest MAY throw — let it propagate before any HTTP call.
        // Consumer-specific gating (e.g. "assert parent db") plugs in here.
        const hookCtx = cfg.hooks && cfg.hooks.beforeRequest
            ? cfg.hooks.beforeRequest(url, options)
            : undefined;
        let lastErr;
        let finalResp;
        for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
            try {
                await limiter.acquire();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
                const resp = await fetch(url, { headers, signal: controller.signal, ...options });
                clearTimeout(timeout);
                if (resp.ok) {
                    if (isMut)
                        auditLog(cfg.auditDir, { ...auditBase, ok: true, status: resp.status, durationMs: Date.now() - startTime });
                    finalResp = resp;
                    break;
                }
                if (resp.status === 429) {
                    const retryAfter = parseInt(resp.headers.get("Retry-After") || "2", 10);
                    console.warn(`⏳ Rate limited — retry in ${retryAfter}s (attempt ${attempt + 1}/${cfg.maxRetries})`);
                    lastErr = { status: resp.status, body: await resp.text().catch(() => "") };
                    await sleep(retryAfter * 1000);
                    continue;
                }
                if (resp.status >= 500) {
                    console.warn(`⏳ Server error ${resp.status} — retry in ${cfg.serverErrorDelayMs}ms (attempt ${attempt + 1}/${cfg.maxRetries})`);
                    lastErr = { status: resp.status, body: await resp.text().catch(() => "") };
                    await sleep(cfg.serverErrorDelayMs);
                    continue;
                }
                lastErr = { status: resp.status, body: await resp.text() };
                break;
            }
            catch (err) {
                console.warn(`⏳ Network error: ${err.code || err.message} — retry in ${cfg.networkErrorDelayMs}ms (attempt ${attempt + 1}/${cfg.maxRetries})`);
                lastErr = { status: 0, body: err.message };
                await sleep(cfg.networkErrorDelayMs);
            }
        }
        if (finalResp) {
            if (cfg.hooks && cfg.hooks.afterResponse) {
                try {
                    cfg.hooks.afterResponse(hookCtx, url, options, finalResp);
                }
                catch (_) { /* never throw */ }
            }
            return finalResp;
        }
        if (isMut)
            auditLog(cfg.auditDir, { ...auditBase, ok: false, error: lastErr, durationMs: Date.now() - startTime });
        // Shape must be Response-like: callers `await resp.text()` / `resp.json()` when !ok.
        const body = (lastErr && lastErr.body) || "";
        const failResp = {
            ok: false,
            status: (lastErr && lastErr.status) || 0,
            body,
            text: async () => body,
            json: async () => { try {
                return JSON.parse(body);
            }
            catch {
                return {};
            } },
        };
        if (cfg.hooks && cfg.hooks.afterResponse) {
            try {
                cfg.hooks.afterResponse(hookCtx, url, options, failResp);
            }
            catch (_) { /* never throw */ }
        }
        return failResp;
    }
    async function queryAll(dbId, filter, propertyIds) {
        const pages = [];
        let hasMore = true, cursor;
        // filter_properties = repeated URL param. IDs from schema are already %-encoded —
        // we must send them so the server sees the original encoded form (hence encodeURIComponent).
        const qs = (propertyIds && propertyIds.length)
            ? "?" + propertyIds.map((id) => `filter_properties=${encodeURIComponent(id)}`).join("&")
            : "";
        while (hasMore) {
            const body = { page_size: 100 };
            if (filter)
                body.filter = filter;
            if (cursor)
                body.start_cursor = cursor;
            const resp = await request(`${cfg.baseUrl}/v1/databases/${dbId}/query${qs}`, {
                method: "POST", body: JSON.stringify(body),
            });
            if (!resp.ok) {
                console.error(`❌ Query ${dbId} failed: ${resp.status}`);
                return pages;
            }
            const data = await resp.json();
            pages.push(...(data.results || []));
            hasMore = data.has_more;
            cursor = data.next_cursor;
            if (hasMore)
                await sleep(cfg.batchDelayMs);
        }
        return pages;
    }
    async function fetchPageTitle(pageId) {
        const resp = await request(`${cfg.baseUrl}/v1/pages/${pageId}`);
        if (!resp.ok)
            return null;
        const page = await resp.json();
        for (const prop of Object.values(page.properties || {})) {
            if (prop.type === "title")
                return (prop.title || []).map((t) => t.plain_text).join("");
        }
        return null;
    }
    async function updatePage(pageId, properties) {
        const resp = await request(`${cfg.baseUrl}/v1/pages/${pageId}`, {
            method: "PATCH", body: JSON.stringify({ properties }),
        });
        if (!resp.ok) {
            let detail = "";
            try {
                const j = await resp.json();
                detail = j.message || j.code || "";
            }
            catch { }
            console.warn(`⚠️ Update ${pageId} failed: ${resp.status}${detail ? " — " + detail : ""}`);
            return false;
        }
        return true;
    }
    async function archivePage(pageId) {
        const resp = await request(`${cfg.baseUrl}/v1/pages/${pageId}`, {
            method: "PATCH", body: JSON.stringify({ archived: true }),
        });
        return resp.ok;
    }
    return { headers, request, queryAll, fetchPageTitle, updatePage, archivePage };
}
module.exports = { createNotionClient };
