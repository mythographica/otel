/** Structural minimum of an HTTP request any framework can satisfy. */
export interface RequestLike {
    method: string;
    url: string;
    params?: unknown;
    query?: unknown;
    body?: unknown;
    headers?: unknown;
}
export interface FeedPreRootOptions {
    /**
     * Link the raw request object into the pre-root record (`raw.request`)
     * AND stamp it as a correlation key, so getPreRoot(req) resolves from
     * anywhere the request is reachable — e.g. an error boundary holding
     * only the request. Retention is unchanged: the record dies with the
     * request.
     */
    storeRequest?: boolean;
}
export declare function feedPreRootFromRequest(req: RequestLike, options?: FeedPreRootOptions): void;
//# sourceMappingURL=feed-from-request.d.ts.map