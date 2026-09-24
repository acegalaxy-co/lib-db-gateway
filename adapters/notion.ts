"use strict";
const { IDBAdapter } = require("./adapter-interface");

// 32-hex UUID, dashes optional (standard 8-4-4-4-12 or 32 contiguous hex chars).
const RAW_ID_REGEX = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
// `notion:<type>:<8hex>` form produced by consumers' URL-target normalizers (e.g. Nexus db-shadow).
const SHADOW_TARGET_REGEX = /^notion:(databases|pages|blocks):[a-f0-9]{8}$/i;

const DEFAULT_NOTION_VERSION = "2022-06-28";
const DEFAULT_BASE_URL = "https://api.notion.com/v1";

interface NotionAdapterOptions {
  token?: string;
  notionVersion?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  // Internal-only: injectable sleep for tests, avoids real waiting on 429 retry.
  _sleep?: (ms: number) => Promise<void>;
}

function _normalizeOp(op: string | undefined): string | undefined {
  if (op === "select") return "read";
  if (op === "insert") return "create";
  return op; // read|create|update|archive|delete pass through unchanged; unknown falls through as-is.
}

function _defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extracts a short machine code from a Notion error body without leaking full
// body contents (which may echo back request data) into the thrown message.
async function _errorCode(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof (body as { code?: unknown }).code === "string") {
      return (body as { code: string }).code;
    }
  } catch (_e) {
    // body not JSON / already consumed — fall through to "unknown".
  }
  return "unknown";
}

class NotionAdapter extends IDBAdapter {
  private _opts: NotionAdapterOptions;

  constructor(opts: NotionAdapterOptions = {}) {
    super();
    this._opts = opts;
  }

  get store(): string {
    return "notion";
  }

  /**
   * Validate a request without I/O. Throws on invalid request.
   * - delete is hard-blocked (defence in depth, mirrors authz L3_notion_delete).
   * - table must be a raw Notion id or a SHADOW_TARGET form.
   */
  validate(request: { op?: string; table?: string } | null | undefined): void {
    const op = _normalizeOp(request ? request.op : undefined);

    if (op === "delete") {
      throw new Error("notion.delete blocked — use archive (rules/db/02-notion-no-delete.md)");
    }

    const table = request && request.table;
    if (typeof table !== "string" || !(RAW_ID_REGEX.test(table) || SHADOW_TARGET_REGEX.test(table))) {
      throw new Error("NotionAdapter: unparseable target");
    }
  }

  // Performs `fetchImpl(url, init)`, retrying once if the response is 429,
  // honoring `Retry-After` (seconds) when present. Never retries more than once.
  private async _fetchWithRetry(
    fetchImpl: typeof fetch,
    url: string,
    init: RequestInit,
    sleepFn: (ms: number) => Promise<void>
  ): Promise<Response> {
    let res = await fetchImpl(url, init);
    if (res.status === 429) {
      const retryAfterHeader = res.headers && typeof res.headers.get === "function" ? res.headers.get("Retry-After") : null;
      const retryAfterSec = retryAfterHeader !== null ? Number(retryAfterHeader) : 1;
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec >= 0 ? retryAfterSec * 1000 : 1000;
      await sleepFn(waitMs);
      res = await fetchImpl(url, init);
    }
    return res;
  }

  private async _requestJson(
    fetchImpl: typeof fetch,
    sleepFn: (ms: number) => Promise<void>,
    url: string,
    init: RequestInit
  ): Promise<unknown> {
    const res = await this._fetchWithRetry(fetchImpl, url, init, sleepFn);
    if (!res.ok) {
      const code = await _errorCode(res);
      throw new Error(`notion ${res.status} ${code}`);
    }
    return res.json();
  }

  async execute(request: {
    op?: string;
    table?: string;
    where?: { pageId?: string; filter?: unknown; sorts?: unknown; pageSize?: number; startCursor?: string };
    data?: Record<string, unknown>;
  } | null | undefined): Promise<{ rows?: unknown[]; rowCount?: number }> {
    this.validate(request);

    const token = this._opts.token || process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error("notion token not configured");
    }

    const table = (request as { table: string }).table;
    if (!RAW_ID_REGEX.test(table)) {
      // SHADOW_TARGET form passes validate() (dryRun-only) but has no real Notion
      // database/page id to call REST against — execute() must reject it.
      throw new Error("NotionAdapter.execute: SHADOW_TARGET is not a real target, dryRun only");
    }

    const op = _normalizeOp((request as { op?: string }).op);
    const fetchImpl = this._opts.fetch || fetch;
    const sleepFn = this._opts._sleep || _defaultSleep;
    const baseUrl = this._opts.baseUrl || DEFAULT_BASE_URL;
    const notionVersion = this._opts.notionVersion || DEFAULT_NOTION_VERSION;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    };
    const where = (request as { where?: { pageId?: string; filter?: unknown; sorts?: unknown; pageSize?: number; startCursor?: string } }).where;
    const data = (request as { data?: Record<string, unknown> }).data;

    if (op === "read") {
      if (where && where.pageId) {
        const page = await this._requestJson(fetchImpl, sleepFn, `${baseUrl}/pages/${where.pageId}`, {
          method: "GET",
          headers,
        });
        return { rows: [page], rowCount: 1 };
      }

      const body: Record<string, unknown> = {};
      if (where && where.filter !== undefined) body.filter = where.filter;
      if (where && where.sorts !== undefined) body.sorts = where.sorts;
      body.page_size = where && where.pageSize !== undefined ? where.pageSize : 100;
      if (where && where.startCursor !== undefined) body.start_cursor = where.startCursor;

      const result = (await this._requestJson(fetchImpl, sleepFn, `${baseUrl}/databases/${table}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })) as { results?: unknown[] };
      const rows = Array.isArray(result.results) ? result.results : [];
      return { rows, rowCount: rows.length };
    }

    if (op === "write" || op === "create") {
      const page = await this._requestJson(fetchImpl, sleepFn, `${baseUrl}/pages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ parent: { database_id: table }, properties: data || {} }),
      });
      return { rows: [page], rowCount: 1 };
    }

    if (op === "update") {
      if (!where || !where.pageId) {
        throw new Error("NotionAdapter.execute: update requires where.pageId");
      }
      const page = await this._requestJson(fetchImpl, sleepFn, `${baseUrl}/pages/${where.pageId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties: data || {} }),
      });
      return { rows: [page], rowCount: 1 };
    }

    if (op === "archive") {
      if (!where || !where.pageId) {
        throw new Error("NotionAdapter.execute: archive requires where.pageId");
      }
      const page = await this._requestJson(fetchImpl, sleepFn, `${baseUrl}/pages/${where.pageId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ archived: true }),
      });
      return { rows: [page], rowCount: 1 };
    }

    // delete is already blocked by validate() above; unknown ops fall through here.
    throw new Error(`NotionAdapter.execute: unsupported op '${op}'`);
  }
}

function create(opts: NotionAdapterOptions = {}): NotionAdapter {
  return new NotionAdapter(opts);
}

export = { NotionAdapter, create };
