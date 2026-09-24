"use strict";
// types.ts is interfaces only — use import() for type refs, no runtime require.

abstract class IDBAdapter {
  abstract get store(): "postgres" | "sqlite" | "notion";

  /**
   * Validate a request without performing any I/O. Throws on invalid request.
   * Used by dryRun mode (L2-L4 + validate only, no execute).
   */
  abstract validate(request: import("../types").QueryRequest): void | Promise<void>;

  abstract execute(
    request: import("../types").QueryRequest
  ): Promise<{ rows?: unknown[]; rowCount?: number }>;
}

export = { IDBAdapter };
