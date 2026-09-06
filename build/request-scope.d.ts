/**
 * HTTP request scope — the framework-free half of the adapter's trace
 * middleware: one OTel span per HTTP request, visible to mnemonica hooks
 * through the provider's own ALS AND to dive spans through the OTEL global
 * context, with the async-flow root frame outermost when provided.
 *
 * Framework mapping notes:
 *  - Express-style middleware: call with (req, res, deps, () => next()).
 *  - Fastify: onRequest hook — call with (request.raw, reply.raw, deps,
 *    () => done()); reply.raw is the underlying ServerResponse.
 *  - raw http: wrap the request listener; ServerResponse emits 'finish'.
 */
import type { Tracer } from '@opentelemetry/api';
import { MnemonicaOtelProvider } from './providers/mnemonica-otel.provider.js';
import { AsyncFlowProvider } from './providers/async-flow.provider.js';
/** Structural minimum of the request. */
export interface HttpRequestLike {
    method: string;
    url: string;
    /** Express exposes the matched route as req.route.path */
    route?: {
        path?: string;
    };
}
/** Structural minimum of the response: a 'finish' event + statusCode. */
export interface HttpResponseLike {
    statusCode: number;
    on(event: 'finish', listener: () => void): unknown;
}
export interface RequestScopeDeps {
    tracer: Tracer;
    otel: MnemonicaOtelProvider;
    asyncFlow?: AsyncFlowProvider;
}
/**
 * Start the request span, hang its ending on response 'finish', and run
 * `fn` inside the triple scope (provider ALS + OTEL global context +
 * async-flow root frame). `fn` is the framework's "continue" callback.
 */
export declare function runInRequestScope(req: HttpRequestLike, res: HttpResponseLike, deps: RequestScopeDeps, fn: () => void): void;
//# sourceMappingURL=request-scope.d.ts.map