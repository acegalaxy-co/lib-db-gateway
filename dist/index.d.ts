type Caller = import("./types").Caller;
type QueryRequest = import("./types").QueryRequest;
type QueryResult = import("./types").QueryResult;
type DbGatewayOptions = import("./types").DbGatewayOptions;
interface DbGateway {
    query(request: QueryRequest, caller: Caller): Promise<QueryResult>;
}
/**
 * Create a DB gateway instance. See types.ts DbGatewayOptions for full contract.
 * A store is only usable if explicitly configured in opts.adapters — an unconfigured
 * store (even a valid store name) denies L1_adapter.
 */
declare function createDbGateway(opts?: DbGatewayOptions): DbGateway;
declare function query(request: QueryRequest, caller: Caller): Promise<QueryResult>;
declare const _default: {
    createDbGateway: typeof createDbGateway;
    query: typeof query;
    IDBAdapter: any;
};
export = _default;
