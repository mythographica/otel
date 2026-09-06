/**
 * Thunderstruck boundary helper — the framework-free half of what a
 * framework's interceptor/middleware does: shape any HTTP framework's
 * request into the
 * raw pre-root payload and stamp its part objects, so pipes and construct
 * handlers correlate the payload by OBJECT IDENTITY (see pre-root.ts for
 * the store's lifetime and correlation semantics).
 *
 * Framework mapping notes:
 *  - Express: pass `req` directly — method/url/params(→req.params)/
 *    query/body/headers all sit on it.
 *  - Fastify: pass the FastifyRequest — it exposes params/query/body/
 *    headers; `method`/`url` exist on it since Fastify v4 (fall back to
 *    `req.raw` if you target older majors).
 *  - raw http: `url`/`method` are on IncomingMessage; body/query/params
 *    are yours to parse first (or omit — primitives and missing parts
 *    simply don't correlate, the feed still records).
 */
import { feedPreRoot, type RawPreRootPayload } from './pre-root.js';

/** Structural minimum of an HTTP request any framework can satisfy. */
export interface RequestLike {
	method   : string;
	url      : string;
	params?  : unknown;
	query?   : unknown;
	body?    : unknown;
	headers? : unknown;
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

export function feedPreRootFromRequest (req: RequestLike, options?: FeedPreRootOptions): void {
	const raw: RawPreRootPayload = {
		method   : req.method,
		url      : req.url,
		params   : req.params,
		query    : req.query,
		body     : req.body,
		headers  : req.headers,
	};
	if (options?.storeRequest === true) {
		raw.request = req;
	}
	feedPreRoot(raw);
}
