"use strict";
/**
 * Notion transport-client config. Env is read lazily — inside
 * `resolveNotionConfig()`, i.e. at createNotionClient() call time, never at
 * module load — so a process that sets NOTION_* env vars right before
 * creating a client is respected. An explicit option always wins over env.
 */

interface RateLimiterLike {
  acquire(): Promise<void>;
}

interface NotionClientHooks {
  // May throw — the throw propagates out of request() before any HTTP call.
  beforeRequest?(url: string, options: any): unknown;
  // Never throws out of request() — wrapped in try/catch by the caller.
  afterResponse?(ctx: unknown, url: string, options: any, resp: any): void;
}

interface NotionClientConfig {
  token?: string;
  apiVersion?: string;
  baseUrl?: string;
  rateIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  serverErrorDelayMs?: number;
  networkErrorDelayMs?: number;
  batchDelayMs?: number;
  auditDir?: string;
  limiter?: RateLimiterLike;
  hooks?: NotionClientHooks;
}

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

function _envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function resolveNotionConfig(partial?: NotionClientConfig): Required<Omit<NotionClientConfig, "token" | "auditDir" | "limiter" | "hooks">> & NotionClientConfig {
  const p = partial || {};
  return {
    token: p.token !== undefined ? p.token : process.env.NOTION_TOKEN,
    apiVersion: p.apiVersion || process.env.NOTION_API_VERSION || DEFAULTS.apiVersion,
    baseUrl: p.baseUrl || process.env.NOTION_BASE_URL || DEFAULTS.baseUrl,
    rateIntervalMs: p.rateIntervalMs !== undefined ? p.rateIntervalMs : _envNum("NOTION_RATE_INTERVAL_MS", DEFAULTS.rateIntervalMs),
    maxRetries: p.maxRetries !== undefined ? p.maxRetries : _envNum("NOTION_MAX_RETRIES", DEFAULTS.maxRetries),
    timeoutMs: p.timeoutMs !== undefined ? p.timeoutMs : _envNum("NOTION_TIMEOUT_MS", DEFAULTS.timeoutMs),
    serverErrorDelayMs: p.serverErrorDelayMs !== undefined ? p.serverErrorDelayMs : _envNum("NOTION_SERVER_ERROR_DELAY_MS", DEFAULTS.serverErrorDelayMs),
    networkErrorDelayMs: p.networkErrorDelayMs !== undefined ? p.networkErrorDelayMs : _envNum("NOTION_NETWORK_ERROR_DELAY_MS", DEFAULTS.networkErrorDelayMs),
    batchDelayMs: p.batchDelayMs !== undefined ? p.batchDelayMs : _envNum("NOTION_BATCH_DELAY_MS", DEFAULTS.batchDelayMs),
    auditDir: p.auditDir !== undefined ? p.auditDir : process.env.NOTION_CLIENT_AUDIT_DIR,
    limiter: p.limiter,
    hooks: p.hooks,
  };
}

export = { resolveNotionConfig, DEFAULTS };
