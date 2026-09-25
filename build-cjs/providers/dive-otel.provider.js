"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiveOtelProvider = void 0;
const api_1 = require("@opentelemetry/api");
const dive_1 = require("@mnemonica/dive");
// Call/method/construct edges carry their callsite as `name`
// (`/abs/file.ts:line:col`, 1-based) — surfaced as OTEL semconv code.*
// attributes so Jaeger can link straight to the source.
const CALLSITE_RE = /^(.*):(\d+):(\d+)$/;
// The strategy push channel (an injected script,
// see strategy/cdp-scripts/ws-server.js) cannot see OTEL spans, so the
// adapter publishes edgeId → traceId on a bounded global map; the push
// mapper forwards it and mnemographica's Live Trace gains the "Open in
// Jaeger" jump. globalThis because adapter and injected script share a
// process, not a module graph.
const EDGE_TRACES_LIMIT = 10000;
function edgeTraceMap() {
    const g = globalThis;
    if (!g.__mnemonicaDiveTraceIds) {
        g.__mnemonicaDiveTraceIds = new Map();
    }
    const map = g.__mnemonicaDiveTraceIds;
    return map;
}
function recordEdgeTrace(edgeId, traceId) {
    const map = edgeTraceMap();
    if (map.has(edgeId)) {
        map.delete(edgeId);
    }
    else if (map.size >= EDGE_TRACES_LIMIT) {
        // FIFO: the oldest entry dies first — Map iterates insertion order
        const oldest = map.keys().next();
        if (!oldest.done) {
            map.delete(oldest.value);
        }
    }
    map.set(edgeId, traceId);
}
class DiveOtelProvider {
    tracer;
    // open spans, keyed on dive edge id — drained by leave/settle
    spans = new Map();
    // edge id → parentId, for the root-edge walk (dive.root_edge_id span
    // attribute). Never drained mid-flight: a completed edge can still
    // parent later children (a create edge adopts the next wrapped call).
    edgeParents = new Map();
    // Per-edge memory lives exactly as long as dive retains the edge — no
    // count. dive hands the hooks the very edge objects its object graph
    // holds; when one becomes unreachable (settled, unpinned, no live child
    // — or clear()) and is collected, its entry is released. The WeakRef
    // guards id reuse: dive's clear() restarts ids at 1, so an id may
    // already name a newer, live edge when an old edge's release arrives —
    // that entry stays.
    edgeRefs = new Map();
    released = new FinalizationRegistry((edgeId) => {
        const ref = this.edgeRefs.get(edgeId);
        if (ref && ref.deref() !== undefined) {
            return;
        }
        this.edgeRefs.delete(edgeId);
        this.edgeParents.delete(edgeId);
    });
    detachers = [];
    constructor(tracer) {
        this.tracer = tracer ?? api_1.trace.getTracer('@mnemonica/otel');
    }
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every span. Dive's clear() wipes subscribers — re-attach after it.
     */
    attach() {
        if (this.detachers.length > 0) {
            return;
        }
        this.detachers.push((0, dive_1.registerHook)('enter', (payload) => {
            this.onEnter(payload);
        }), (0, dive_1.registerHook)('leave', (payload) => {
            this.onLeave(payload);
        }), (0, dive_1.registerHook)('settle', (payload) => {
            this.onSettle(payload);
        }), (0, dive_1.registerHook)('recontext', (payload) => {
            this.onRecontext(payload);
        }));
        try {
            this.detachers.push((0, dive_1.registerHook)('create', (payload) => {
                this.onCreate(payload);
            }));
        }
        catch {
            // The 'create' event exists since dive 0.8.0; on 0.7.x registerHook
            // throws on the unknown event. Skipping it there preserves exactly
            // the pre-subscription behavior (constructions stay unspanned), so
            // the widened ^0.7.0 || ^0.8.0 peer range stays honest.
        }
    }
    detach() {
        for (const detach of this.detachers) {
            detach();
        }
        this.detachers = [];
    }
    onEnter({ edge }) {
        const parentSpan = this.findParentSpan(edge);
        const ctx = parentSpan
            ? api_1.trace.setSpan(api_1.context.active(), parentSpan)
            : undefined;
        const name = `dive.${edge.kind}:${edge.name}`;
        const span = ctx
            ? this.tracer.startSpan(name, {}, ctx)
            : this.tracer.startSpan(name);
        span.setAttribute('dive.edge_id', edge.id);
        span.setAttribute('dive.kind', edge.kind);
        span.setAttribute('dive.name', edge.name);
        this.decorateSpan(span, edge);
        this.spans.set(edge.id, span);
    }
    onLeave({ edge, result }) {
        if (result instanceof Promise) {
            // async work: the span closes at settle, not at the sync head —
            // "the function returned" is not "the work is done"
            return;
        }
        this.closeSpan(edge);
    }
    onSettle({ edge, error }) {
        this.closeSpan(edge, error);
    }
    onRecontext({ edge, previousContext, context }) {
        // One-shot span: the ownership transfer itself, parented on the OLD
        // context's span (the handoff edge's parentId), so the trace shows
        // where the callback's story crossed flows.
        const parentSpan = this.findParentSpan(edge);
        const ctx = parentSpan
            ? api_1.trace.setSpan(api_1.context.active(), parentSpan)
            : undefined;
        const name = `dive.${edge.kind}:${edge.name}`;
        const span = ctx
            ? this.tracer.startSpan(name, {}, ctx)
            : this.tracer.startSpan(name);
        span.setAttribute('dive.edge_id', edge.id);
        span.setAttribute('dive.kind', edge.kind);
        span.setAttribute('dive.name', edge.name);
        span.setAttribute('dive.handoff', true);
        span.setAttribute('dive.handoff.had_previous', previousContext !== undefined);
        span.setAttribute('dive.handoff.has_context', context !== undefined);
        this.decorateSpan(span, edge);
        span.end();
    }
    onCreate({ edge, error }) {
        // One-shot span: the construction already completed when recordCreation
        // fired (the hook moment IS the completion), so the span starts and
        // ends here — same shape as recontext. findParentSpan adopts the
        // wrapped call's span via edge.parentId, or the active request span at
        // a boundary, so constructions join the request trace instead of
        // opening a root trace of their own.
        const parentSpan = this.findParentSpan(edge);
        const ctx = parentSpan
            ? api_1.trace.setSpan(api_1.context.active(), parentSpan)
            : undefined;
        const name = `dive.${edge.kind}:${edge.name}`;
        const span = ctx
            ? this.tracer.startSpan(name, {}, ctx)
            : this.tracer.startSpan(name);
        span.setAttribute('dive.edge_id', edge.id);
        span.setAttribute('dive.kind', edge.kind);
        span.setAttribute('dive.name', edge.name);
        span.setAttribute('dive.status', edge.status);
        if (edge.duration !== undefined) {
            span.setAttribute('dive.duration_ms', edge.duration);
        }
        this.decorateSpan(span, edge);
        if (edge.status === 'error') {
            span.setStatus({ code: api_1.SpanStatusCode.ERROR });
            if (error instanceof Error) {
                span.recordException(error);
            }
        }
        span.end();
    }
    findParentSpan(edge) {
        if (edge.parentId !== null) {
            const own = this.spans.get(edge.parentId);
            if (own) {
                return own;
            }
        }
        // Boundary (or evicted parent): adopt the active OTel span — the HTTP
        // request span becomes the root of the dive branch.
        const active = api_1.trace.getSpan(api_1.context.active());
        return active;
    }
    closeSpan(edge, error) {
        const span = this.spans.get(edge.id);
        if (!span) {
            return;
        }
        this.spans.delete(edge.id);
        span.setAttribute('dive.status', edge.status);
        if (edge.duration !== undefined) {
            span.setAttribute('dive.duration_ms', edge.duration);
        }
        if (edge.status === 'error') {
            // sync throws carry no error value in the leave payload — the
            // edge's own status is the truthful signal; the exception record
            // is available only when settle carried the rejection itself
            span.setStatus({ code: api_1.SpanStatusCode.ERROR });
            if (error instanceof Error) {
                span.recordException(error);
            }
        }
        span.end();
    }
    // Register an edge for release once, the first time the provider sees it.
    track(edge) {
        const known = this.edgeRefs.get(edge.id);
        if (known && known.deref() === edge) {
            return;
        }
        this.edgeRefs.set(edge.id, new WeakRef(edge));
        this.released.register(edge, edge.id);
    }
    /**
     * Cross-surface attributes every span gets, on every hook path:
     * the edge's trace root id (Jaeger link → mnemographica's Live Trace),
     * the edgeId→traceId publication for the strategy push channel, and
     * code.filepath/line/column parsed from the callsite name.
     */
    decorateSpan(span, edge) {
        span.setAttribute('dive.root_edge_id', this.rootEdgeIdOf(edge));
        recordEdgeTrace(edge.id, span.spanContext().traceId);
        if (edge.kind !== 'call' && edge.kind !== 'method' && edge.kind !== 'construct') {
            return;
        }
        const match = CALLSITE_RE.exec(edge.name);
        if (!match) {
            return;
        }
        span.setAttribute('code.filepath', match[1]);
        span.setAttribute('code.lineno', Number(match[2]));
        span.setAttribute('code.column', Number(match[3]));
    }
    // Walk dive's parentage to the root edge id. Parents are recorded as
    // edges arrive (enter fires parent-before-child), so the chain is
    // complete for anything still in flight; an evicted/unknown parent
    // simply ends the walk at the deepest known id.
    rootEdgeIdOf(edge) {
        this.track(edge);
        this.edgeParents.set(edge.id, edge.parentId);
        let id = edge.id;
        let parent = edge.parentId;
        const seen = new Set([id]);
        while (parent !== null && !seen.has(parent)) {
            seen.add(parent);
            id = parent;
            const next = this.edgeParents.get(parent);
            parent = next === undefined ? null : next;
        }
        return id;
    }
}
exports.DiveOtelProvider = DiveOtelProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGl2ZS1vdGVsLnByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBb0JBLDRDQUFtRjtBQUNuRiwwQ0FReUI7QUFFekIsNkRBQTZEO0FBQzdELHVFQUF1RTtBQUN2RSx3REFBd0Q7QUFDeEQsTUFBTSxXQUFXLEdBQUcsb0JBQW9CLENBQUM7QUFFekMsaURBQWlEO0FBQ2pELHVFQUF1RTtBQUN2RSx1RUFBdUU7QUFDdkUsdUVBQXVFO0FBQ3ZFLHVFQUF1RTtBQUN2RSwrQkFBK0I7QUFDL0IsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLENBQUM7QUFFaEMsU0FBUyxZQUFZO0lBQ3BCLE1BQU0sQ0FBQyxHQUFHLFVBQXdELENBQUM7SUFDbkUsSUFBSSxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1FBQ2hDLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFDRCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsdUJBQXVCLENBQUM7SUFDdEMsT0FBTyxHQUFHLENBQUM7QUFDWixDQUFDO0FBQ0QsU0FBUyxlQUFlLENBQUUsTUFBYyxFQUFFLE9BQWU7SUFDeEQsTUFBTSxHQUFHLEdBQUcsWUFBWSxFQUFFLENBQUM7SUFDM0IsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDckIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNwQixDQUFDO1NBQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLGlCQUFpQixFQUFFLENBQUM7UUFDMUMsbUVBQW1FO1FBQ25FLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2xCLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzFCLENBQUM7SUFDRixDQUFDO0lBQ0QsR0FBRyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDMUIsQ0FBQztBQUVELE1BQWEsZ0JBQWdCO0lBQ3BCLE1BQU0sQ0FBUztJQUN2Qiw4REFBOEQ7SUFDdEQsS0FBSyxHQUFHLElBQUksR0FBRyxFQUFnQixDQUFDO0lBQ3hDLHFFQUFxRTtJQUNyRSxtRUFBbUU7SUFDbkUsc0VBQXNFO0lBQzlELFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBeUIsQ0FBQztJQUN2RCxzRUFBc0U7SUFDdEUscUVBQXFFO0lBQ3JFLHdFQUF3RTtJQUN4RSxxRUFBcUU7SUFDckUsa0VBQWtFO0lBQ2xFLHVFQUF1RTtJQUN2RSxvQkFBb0I7SUFDWixRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQTZCLENBQUM7SUFDaEQsUUFBUSxHQUFHLElBQUksb0JBQW9CLENBQVMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtRQUM5RCxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN0QyxJQUFJLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdEMsT0FBTztRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUM3QixJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNqQyxDQUFDLENBQUMsQ0FBQztJQUNLLFNBQVMsR0FBc0IsRUFBRSxDQUFDO0lBRTFDLFlBQWEsTUFBZTtRQUMzQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sSUFBSSxXQUFLLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDNUQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDTCxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQ2xCLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxRQUFRLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3hCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxXQUFXLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNyQyxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzNCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDRixJQUFJLENBQUM7WUFDSixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBQSxtQkFBWSxFQUFDLFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO2dCQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDSCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1Isb0VBQW9FO1lBQ3BFLG1FQUFtRTtZQUNuRSxtRUFBbUU7WUFDbkUsd0RBQXdEO1FBQ3pELENBQUM7SUFDRixDQUFDO0lBRUQsTUFBTTtRQUNMLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3JDLE1BQU0sRUFBRSxDQUFDO1FBQ1YsQ0FBQztRQUNELElBQUksQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDO0lBQ3JCLENBQUM7SUFFTyxPQUFPLENBQUUsRUFBRSxJQUFJLEVBQW9CO1FBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0MsTUFBTSxHQUFHLEdBQUcsVUFBVTtZQUNyQixDQUFDLENBQUMsV0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFXLENBQUMsTUFBTSxFQUFFLEVBQUUsVUFBVSxDQUFDO1lBQ2pELENBQUMsQ0FBQyxTQUFTLENBQUM7UUFDYixNQUFNLElBQUksR0FBRyxRQUFRLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQzlDLE1BQU0sSUFBSSxHQUFHLEdBQUc7WUFDZixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUM7WUFDdEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRS9CLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUMzQyxJQUFJLENBQUMsWUFBWSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDMUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTlCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDL0IsQ0FBQztJQUVPLE9BQU8sQ0FBRSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQW9CO1FBQ2xELElBQUksTUFBTSxZQUFZLE9BQU8sRUFBRSxDQUFDO1lBQy9CLGdFQUFnRTtZQUNoRSxvREFBb0Q7WUFDcEQsT0FBTztRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3RCLENBQUM7SUFFTyxRQUFRLENBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFxQjtRQUNuRCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztJQUM3QixDQUFDO0lBRU8sV0FBVyxDQUFFLEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQXdCO1FBQzVFLG9FQUFvRTtRQUNwRSxtRUFBbUU7UUFDbkUsNENBQTRDO1FBQzVDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0MsTUFBTSxHQUFHLEdBQUcsVUFBVTtZQUNyQixDQUFDLENBQUMsV0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFXLENBQUMsTUFBTSxFQUFFLEVBQUUsVUFBVSxDQUFDO1lBQ2pELENBQUMsQ0FBQyxTQUFTLENBQUM7UUFDYixNQUFNLElBQUksR0FBRyxRQUFRLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQzlDLE1BQU0sSUFBSSxHQUFHLEdBQUc7WUFDZixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUM7WUFDdEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRS9CLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUMzQyxJQUFJLENBQUMsWUFBWSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDMUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxZQUFZLENBQUMsMkJBQTJCLEVBQUUsZUFBZSxLQUFLLFNBQVMsQ0FBQyxDQUFDO1FBQzlFLElBQUksQ0FBQyxZQUFZLENBQUMsMEJBQTBCLEVBQUUsT0FBTyxLQUFLLFNBQVMsQ0FBQyxDQUFDO1FBQ3JFLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzlCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFTyxRQUFRLENBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFxQjtRQUNuRCx3RUFBd0U7UUFDeEUsb0VBQW9FO1FBQ3BFLGlFQUFpRTtRQUNqRSx1RUFBdUU7UUFDdkUsaUVBQWlFO1FBQ2pFLHFDQUFxQztRQUNyQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzdDLE1BQU0sR0FBRyxHQUFHLFVBQVU7WUFDckIsQ0FBQyxDQUFDLFdBQUssQ0FBQyxPQUFPLENBQUMsYUFBVyxDQUFDLE1BQU0sRUFBRSxFQUFFLFVBQVUsQ0FBQztZQUNqRCxDQUFDLENBQUMsU0FBUyxDQUFDO1FBQ2IsTUFBTSxJQUFJLEdBQUcsUUFBUSxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM5QyxNQUFNLElBQUksR0FBRyxHQUFHO1lBQ2YsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsR0FBRyxDQUFDO1lBQ3RDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUUvQixJQUFJLENBQUMsWUFBWSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDOUMsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQyxZQUFZLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3RELENBQUM7UUFDRCxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztRQUM5QixJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssT0FBTyxFQUFFLENBQUM7WUFDN0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxvQkFBYyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDL0MsSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDN0IsQ0FBQztRQUNGLENBQUM7UUFDRCxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRU8sY0FBYyxDQUFFLElBQWM7UUFBdUIsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3hGLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUMxQyxJQUFJLEdBQUcsRUFBRSxDQUFDO2dCQUNULE9BQU8sR0FBRyxDQUFDO1lBQ1osQ0FBQztRQUNGLENBQUM7UUFDRCxzRUFBc0U7UUFDdEUsb0RBQW9EO1FBQ3BELE1BQU0sTUFBTSxHQUFHLFdBQUssQ0FBQyxPQUFPLENBQUMsYUFBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDbkQsT0FBTyxNQUFNLENBQUM7SUFDZixDQUFDO0lBRU8sU0FBUyxDQUFFLElBQWMsRUFBRSxLQUFlO1FBQ2pELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNyQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDWCxPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUUzQixJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDOUMsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQyxZQUFZLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3RELENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssT0FBTyxFQUFFLENBQUM7WUFDN0IsOERBQThEO1lBQzlELGlFQUFpRTtZQUNqRSw2REFBNkQ7WUFDN0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxvQkFBYyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDL0MsSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDN0IsQ0FBQztRQUNGLENBQUM7UUFDRCxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsMEVBQTBFO0lBQ2xFLEtBQUssQ0FBRSxJQUFjO1FBQzVCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN6QyxJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDckMsT0FBTztRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLElBQUksT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDOUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSyxZQUFZLENBQUUsSUFBVSxFQUFFLElBQWM7UUFDL0MsSUFBSSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDaEUsZUFBZSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3JELElBQUksSUFBSSxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksSUFBSSxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxDQUFDLElBQUksS0FBSyxXQUFXLEVBQUUsQ0FBQztZQUNqRixPQUFPO1FBQ1IsQ0FBQztRQUNELE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNaLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxDQUFDLFlBQVksQ0FBQyxlQUFlLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDN0MsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbkQsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELHFFQUFxRTtJQUNyRSxrRUFBa0U7SUFDbEUsbUVBQW1FO0lBQ25FLGdEQUFnRDtJQUN4QyxZQUFZLENBQUUsSUFBYztRQUNuQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pCLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzdDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDakIsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUMzQixNQUFNLElBQUksR0FBRyxJQUFJLEdBQUcsQ0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDbkMsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQzdDLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDakIsRUFBRSxHQUFHLE1BQU0sQ0FBQztZQUNaLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQzFDLE1BQU0sR0FBRyxJQUFJLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztRQUMzQyxDQUFDO1FBQ0QsT0FBTyxFQUFFLENBQUM7SUFDWCxDQUFDO0NBQ0Q7QUFwUEQsNENBb1BDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IHByb3ZpZGVyIGZvciBkaXZlJ3MgZWRnZSBsaWZlY3ljbGUgaG9va3MuXG4gKlxuICogV2hlcmUgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIHNwYW5zIENPTlNUUlVDVElPTlMgKG1uZW1vbmljYSBob29rcyksIHRoaXNcbiAqIHByb3ZpZGVyIHNwYW5zIEVWRVJZIFdSQVBQRUQgQ0FMTCAoZGl2ZSBob29rcyk6IGNhbGwgLyBjb25zdHJ1Y3QgLyBtZXRob2QgL1xuICogcmVjb250ZXh0IGVkZ2VzIGVhY2ggYmVjb21lIGEgc3BhbiwgcGFyZW50ZWQgb24gdGhlIHNwYW4gb2YgdGhlIGVkZ2Unc1xuICogcGFyZW50SWQg4oCUIGRpdmUncyBvd24gdHJhY2UgcGFyZW50YWdlLCBub3QgQUxTLiBBdCB1bndyYXBwZWQgYm91bmRhcmllc1xuICogKHBhcmVudElkIG51bGwpIHRoZSBzcGFuIGFkb3B0cyB0aGUgY3VycmVudGx5IEFDVElWRSBPVGVsIHNwYW4gYXMgcGFyZW50LFxuICogc28gYW5cbiAqIEhUVFAgcmVxdWVzdCBzcGFuIGFkb3B0cyB0aGUgd2hvbGUgZGl2ZSBicmFuY2guICdjcmVhdGUnIGVkZ2VzIChtbmVtb25pY2FcbiAqIGNvbnN0cnVjdGlvbnMgcmVjb3JkZWQgdmlhIHJlY29yZENyZWF0aW9uL3JlY29yZENyZWF0aW9uRXJyb3IpIGJlY29tZVxuICogb25lLXNob3Qgc3BhbnMgb24gdGhlIHNhbWUgcGFyZW50YWdlIOKAlCB0aGUgY29uc3RydWN0aW9uIEhBUyBjb21wbGV0ZWQgd2hlblxuICogdGhlIGhvb2sgZmlyZXMsIHNvIHRoZSBzcGFuIHN0YXJ0cyBhbmQgZW5kcyBpbnNpZGUgdGhlIGhhbmRsZXIuXG4gKlxuICogQXN5bmMgdHJ1dGhmdWxuZXNzOiBhIHNwYW4gZG9lcyBOT1QgZW5kIGF0IHRoZSBzeW5jIGNsb3NlIHdoZW4gdGhlIHdyYXBcbiAqIHByb2R1Y2VkIGEgdGFwcGVkIHByb21pc2Ug4oCUIGl0IGVuZHMgYXQgc2V0dGxlLCB3aXRoIHRoZSBjaGFpbidzIG91dGNvbWUuXG4gKiBTcGFucyBhcmUga2V5ZWQgb24gZWRnZSBpZDsgZXZlcnkgcmVjb3JkZWQgZWRnZSBmaXJlcyBsZWF2ZSAoYW5kLCB3aGVuXG4gKiBhc3luYywgc2V0dGxlKSwgc28gdGhlIG1hcCBhbHdheXMgZHJhaW5zLlxuICovXG5pbXBvcnQgdHlwZSB7IFNwYW4sIFRyYWNlciB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQgeyBTcGFuU3RhdHVzQ29kZSwgY29udGV4dCBhcyBvdGVsQ29udGV4dCwgdHJhY2UgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHtcblx0cmVnaXN0ZXJIb29rLFxuXHR0eXBlIERpdmVDcmVhdGVQYXlsb2FkLFxuXHR0eXBlIERpdmVFbnRlclBheWxvYWQsXG5cdHR5cGUgRGl2ZUxlYXZlUGF5bG9hZCxcblx0dHlwZSBEaXZlUmVjb250ZXh0UGF5bG9hZCxcblx0dHlwZSBEaXZlU2V0dGxlUGF5bG9hZCxcblx0dHlwZSBGbG93RWRnZSxcbn0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcblxuLy8gQ2FsbC9tZXRob2QvY29uc3RydWN0IGVkZ2VzIGNhcnJ5IHRoZWlyIGNhbGxzaXRlIGFzIGBuYW1lYFxuLy8gKGAvYWJzL2ZpbGUudHM6bGluZTpjb2xgLCAxLWJhc2VkKSDigJQgc3VyZmFjZWQgYXMgT1RFTCBzZW1jb252IGNvZGUuKlxuLy8gYXR0cmlidXRlcyBzbyBKYWVnZXIgY2FuIGxpbmsgc3RyYWlnaHQgdG8gdGhlIHNvdXJjZS5cbmNvbnN0IENBTExTSVRFX1JFID0gL14oLiopOihcXGQrKTooXFxkKykkLztcblxuLy8gVGhlIHN0cmF0ZWd5IHB1c2ggY2hhbm5lbCAoYW4gaW5qZWN0ZWQgc2NyaXB0LFxuLy8gc2VlIHN0cmF0ZWd5L2NkcC1zY3JpcHRzL3dzLXNlcnZlci5qcykgY2Fubm90IHNlZSBPVEVMIHNwYW5zLCBzbyB0aGVcbi8vIGFkYXB0ZXIgcHVibGlzaGVzIGVkZ2VJZCDihpIgdHJhY2VJZCBvbiBhIGJvdW5kZWQgZ2xvYmFsIG1hcDsgdGhlIHB1c2hcbi8vIG1hcHBlciBmb3J3YXJkcyBpdCBhbmQgbW5lbW9ncmFwaGljYSdzIExpdmUgVHJhY2UgZ2FpbnMgdGhlIFwiT3BlbiBpblxuLy8gSmFlZ2VyXCIganVtcC4gZ2xvYmFsVGhpcyBiZWNhdXNlIGFkYXB0ZXIgYW5kIGluamVjdGVkIHNjcmlwdCBzaGFyZSBhXG4vLyBwcm9jZXNzLCBub3QgYSBtb2R1bGUgZ3JhcGguXG5jb25zdCBFREdFX1RSQUNFU19MSU1JVCA9IDEwMDAwO1xudHlwZSBFZGdlVHJhY2VNYXAgPSBNYXA8bnVtYmVyLCBzdHJpbmc+O1xuZnVuY3Rpb24gZWRnZVRyYWNlTWFwICgpOiBFZGdlVHJhY2VNYXAge1xuXHRjb25zdCBnID0gZ2xvYmFsVGhpcyBhcyB7IF9fbW5lbW9uaWNhRGl2ZVRyYWNlSWRzPzogRWRnZVRyYWNlTWFwIH07XG5cdGlmICghZy5fX21uZW1vbmljYURpdmVUcmFjZUlkcykge1xuXHRcdGcuX19tbmVtb25pY2FEaXZlVHJhY2VJZHMgPSBuZXcgTWFwKCk7XG5cdH1cblx0Y29uc3QgbWFwID0gZy5fX21uZW1vbmljYURpdmVUcmFjZUlkcztcblx0cmV0dXJuIG1hcDtcbn1cbmZ1bmN0aW9uIHJlY29yZEVkZ2VUcmFjZSAoZWRnZUlkOiBudW1iZXIsIHRyYWNlSWQ6IHN0cmluZyk6IHZvaWQge1xuXHRjb25zdCBtYXAgPSBlZGdlVHJhY2VNYXAoKTtcblx0aWYgKG1hcC5oYXMoZWRnZUlkKSkge1xuXHRcdG1hcC5kZWxldGUoZWRnZUlkKTtcblx0fSBlbHNlIGlmIChtYXAuc2l6ZSA+PSBFREdFX1RSQUNFU19MSU1JVCkge1xuXHRcdC8vIEZJRk86IHRoZSBvbGRlc3QgZW50cnkgZGllcyBmaXJzdCDigJQgTWFwIGl0ZXJhdGVzIGluc2VydGlvbiBvcmRlclxuXHRcdGNvbnN0IG9sZGVzdCA9IG1hcC5rZXlzKCkubmV4dCgpO1xuXHRcdGlmICghb2xkZXN0LmRvbmUpIHtcblx0XHRcdG1hcC5kZWxldGUob2xkZXN0LnZhbHVlKTtcblx0XHR9XG5cdH1cblx0bWFwLnNldChlZGdlSWQsIHRyYWNlSWQpO1xufVxuXG5leHBvcnQgY2xhc3MgRGl2ZU90ZWxQcm92aWRlciB7XG5cdHByaXZhdGUgdHJhY2VyOiBUcmFjZXI7XG5cdC8vIG9wZW4gc3BhbnMsIGtleWVkIG9uIGRpdmUgZWRnZSBpZCDigJQgZHJhaW5lZCBieSBsZWF2ZS9zZXR0bGVcblx0cHJpdmF0ZSBzcGFucyA9IG5ldyBNYXA8bnVtYmVyLCBTcGFuPigpO1xuXHQvLyBlZGdlIGlkIOKGkiBwYXJlbnRJZCwgZm9yIHRoZSByb290LWVkZ2Ugd2FsayAoZGl2ZS5yb290X2VkZ2VfaWQgc3BhblxuXHQvLyBhdHRyaWJ1dGUpLiBOZXZlciBkcmFpbmVkIG1pZC1mbGlnaHQ6IGEgY29tcGxldGVkIGVkZ2UgY2FuIHN0aWxsXG5cdC8vIHBhcmVudCBsYXRlciBjaGlsZHJlbiAoYSBjcmVhdGUgZWRnZSBhZG9wdHMgdGhlIG5leHQgd3JhcHBlZCBjYWxsKS5cblx0cHJpdmF0ZSBlZGdlUGFyZW50cyA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXIgfCBudWxsPigpO1xuXHQvLyBQZXItZWRnZSBtZW1vcnkgbGl2ZXMgZXhhY3RseSBhcyBsb25nIGFzIGRpdmUgcmV0YWlucyB0aGUgZWRnZSDigJQgbm9cblx0Ly8gY291bnQuIGRpdmUgaGFuZHMgdGhlIGhvb2tzIHRoZSB2ZXJ5IGVkZ2Ugb2JqZWN0cyBpdHMgb2JqZWN0IGdyYXBoXG5cdC8vIGhvbGRzOyB3aGVuIG9uZSBiZWNvbWVzIHVucmVhY2hhYmxlIChzZXR0bGVkLCB1bnBpbm5lZCwgbm8gbGl2ZSBjaGlsZFxuXHQvLyDigJQgb3IgY2xlYXIoKSkgYW5kIGlzIGNvbGxlY3RlZCwgaXRzIGVudHJ5IGlzIHJlbGVhc2VkLiBUaGUgV2Vha1JlZlxuXHQvLyBndWFyZHMgaWQgcmV1c2U6IGRpdmUncyBjbGVhcigpIHJlc3RhcnRzIGlkcyBhdCAxLCBzbyBhbiBpZCBtYXlcblx0Ly8gYWxyZWFkeSBuYW1lIGEgbmV3ZXIsIGxpdmUgZWRnZSB3aGVuIGFuIG9sZCBlZGdlJ3MgcmVsZWFzZSBhcnJpdmVzIOKAlFxuXHQvLyB0aGF0IGVudHJ5IHN0YXlzLlxuXHRwcml2YXRlIGVkZ2VSZWZzID0gbmV3IE1hcDxudW1iZXIsIFdlYWtSZWY8Rmxvd0VkZ2U+PigpO1xuXHRwcml2YXRlIHJlbGVhc2VkID0gbmV3IEZpbmFsaXphdGlvblJlZ2lzdHJ5PG51bWJlcj4oKGVkZ2VJZCkgPT4ge1xuXHRcdGNvbnN0IHJlZiA9IHRoaXMuZWRnZVJlZnMuZ2V0KGVkZ2VJZCk7XG5cdFx0aWYgKHJlZiAmJiByZWYuZGVyZWYoKSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZWRnZVJlZnMuZGVsZXRlKGVkZ2VJZCk7XG5cdFx0dGhpcy5lZGdlUGFyZW50cy5kZWxldGUoZWRnZUlkKTtcblx0fSk7XG5cdHByaXZhdGUgZGV0YWNoZXJzOiBBcnJheTwoKSA9PiB2b2lkPiA9IFtdO1xuXG5cdGNvbnN0cnVjdG9yICh0cmFjZXI/OiBUcmFjZXIpIHtcblx0XHR0aGlzLnRyYWNlciA9IHRyYWNlciA/PyB0cmFjZS5nZXRUcmFjZXIoJ0BtbmVtb25pY2Evb3RlbCcpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFN1YnNjcmliZSB0byBkaXZlJ3MgZWRnZSBsaWZlY3ljbGUuIElkZW1wb3RlbnQ6IGF0dGFjaGluZyB0d2ljZSB3b3VsZFxuXHQgKiBkb3VibGUgZXZlcnkgc3Bhbi4gRGl2ZSdzIGNsZWFyKCkgd2lwZXMgc3Vic2NyaWJlcnMg4oCUIHJlLWF0dGFjaCBhZnRlciBpdC5cblx0ICovXG5cdGF0dGFjaCAoKTogdm9pZCB7XG5cdFx0aWYgKHRoaXMuZGV0YWNoZXJzLmxlbmd0aCA+IDApIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMucHVzaChcblx0XHRcdHJlZ2lzdGVySG9vaygnZW50ZXInLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uRW50ZXIocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHJlZ2lzdGVySG9vaygnbGVhdmUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uTGVhdmUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHJlZ2lzdGVySG9vaygnc2V0dGxlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vblNldHRsZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0cmVnaXN0ZXJIb29rKCdyZWNvbnRleHQnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uUmVjb250ZXh0KHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0KTtcblx0XHR0cnkge1xuXHRcdFx0dGhpcy5kZXRhY2hlcnMucHVzaChcblx0XHRcdFx0cmVnaXN0ZXJIb29rKCdjcmVhdGUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHRcdHRoaXMub25DcmVhdGUocGF5bG9hZCk7XG5cdFx0XHRcdH0pLFxuXHRcdFx0KTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIFRoZSAnY3JlYXRlJyBldmVudCBleGlzdHMgc2luY2UgZGl2ZSAwLjguMDsgb24gMC43LnggcmVnaXN0ZXJIb29rXG5cdFx0XHQvLyB0aHJvd3Mgb24gdGhlIHVua25vd24gZXZlbnQuIFNraXBwaW5nIGl0IHRoZXJlIHByZXNlcnZlcyBleGFjdGx5XG5cdFx0XHQvLyB0aGUgcHJlLXN1YnNjcmlwdGlvbiBiZWhhdmlvciAoY29uc3RydWN0aW9ucyBzdGF5IHVuc3Bhbm5lZCksIHNvXG5cdFx0XHQvLyB0aGUgd2lkZW5lZCBeMC43LjAgfHwgXjAuOC4wIHBlZXIgcmFuZ2Ugc3RheXMgaG9uZXN0LlxuXHRcdH1cblx0fVxuXG5cdGRldGFjaCAoKTogdm9pZCB7XG5cdFx0Zm9yIChjb25zdCBkZXRhY2ggb2YgdGhpcy5kZXRhY2hlcnMpIHtcblx0XHRcdGRldGFjaCgpO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycyA9IFtdO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkVudGVyICh7IGVkZ2UgfTogRGl2ZUVudGVyUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmZpbmRQYXJlbnRTcGFuKGVkZ2UpO1xuXHRcdGNvbnN0IGN0eCA9IHBhcmVudFNwYW5cblx0XHRcdD8gdHJhY2Uuc2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSwgcGFyZW50U3Bhbilcblx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdGNvbnN0IG5hbWUgPSBgZGl2ZS4ke2VkZ2Uua2luZH06JHtlZGdlLm5hbWV9YDtcblx0XHRjb25zdCBzcGFuID0gY3R4XG5cdFx0XHQ/IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lLCB7fSwgY3R4KVxuXHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5lZGdlX2lkJywgZWRnZS5pZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUua2luZCcsIGVkZ2Uua2luZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUubmFtZScsIGVkZ2UubmFtZSk7XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cblx0XHR0aGlzLnNwYW5zLnNldChlZGdlLmlkLCBzcGFuKTtcblx0fVxuXG5cdHByaXZhdGUgb25MZWF2ZSAoeyBlZGdlLCByZXN1bHQgfTogRGl2ZUxlYXZlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG5cdFx0XHQvLyBhc3luYyB3b3JrOiB0aGUgc3BhbiBjbG9zZXMgYXQgc2V0dGxlLCBub3QgYXQgdGhlIHN5bmMgaGVhZCDigJRcblx0XHRcdC8vIFwidGhlIGZ1bmN0aW9uIHJldHVybmVkXCIgaXMgbm90IFwidGhlIHdvcmsgaXMgZG9uZVwiXG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuY2xvc2VTcGFuKGVkZ2UpO1xuXHR9XG5cblx0cHJpdmF0ZSBvblNldHRsZSAoeyBlZGdlLCBlcnJvciB9OiBEaXZlU2V0dGxlUGF5bG9hZCk6IHZvaWQge1xuXHRcdHRoaXMuY2xvc2VTcGFuKGVkZ2UsIGVycm9yKTtcblx0fVxuXG5cdHByaXZhdGUgb25SZWNvbnRleHQgKHsgZWRnZSwgcHJldmlvdXNDb250ZXh0LCBjb250ZXh0IH06IERpdmVSZWNvbnRleHRQYXlsb2FkKTogdm9pZCB7XG5cdFx0Ly8gT25lLXNob3Qgc3BhbjogdGhlIG93bmVyc2hpcCB0cmFuc2ZlciBpdHNlbGYsIHBhcmVudGVkIG9uIHRoZSBPTERcblx0XHQvLyBjb250ZXh0J3Mgc3BhbiAodGhlIGhhbmRvZmYgZWRnZSdzIHBhcmVudElkKSwgc28gdGhlIHRyYWNlIHNob3dzXG5cdFx0Ly8gd2hlcmUgdGhlIGNhbGxiYWNrJ3Mgc3RvcnkgY3Jvc3NlZCBmbG93cy5cblx0XHRjb25zdCBwYXJlbnRTcGFuID0gdGhpcy5maW5kUGFyZW50U3BhbihlZGdlKTtcblx0XHRjb25zdCBjdHggPSBwYXJlbnRTcGFuXG5cdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHQ6IHVuZGVmaW5lZDtcblx0XHRjb25zdCBuYW1lID0gYGRpdmUuJHtlZGdlLmtpbmR9OiR7ZWRnZS5uYW1lfWA7XG5cdFx0Y29uc3Qgc3BhbiA9IGN0eFxuXHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSwge30sIGN0eClcblx0XHRcdDogdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUpO1xuXG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZWRnZV9pZCcsIGVkZ2UuaWQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmtpbmQnLCBlZGdlLmtpbmQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLm5hbWUnLCBlZGdlLm5hbWUpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmhhbmRvZmYnLCB0cnVlKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmLmhhZF9wcmV2aW91cycsIHByZXZpb3VzQ29udGV4dCAhPT0gdW5kZWZpbmVkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmLmhhc19jb250ZXh0JywgY29udGV4dCAhPT0gdW5kZWZpbmVkKTtcblx0XHR0aGlzLmRlY29yYXRlU3BhbihzcGFuLCBlZGdlKTtcblx0XHRzcGFuLmVuZCgpO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkNyZWF0ZSAoeyBlZGdlLCBlcnJvciB9OiBEaXZlQ3JlYXRlUGF5bG9hZCk6IHZvaWQge1xuXHRcdC8vIE9uZS1zaG90IHNwYW46IHRoZSBjb25zdHJ1Y3Rpb24gYWxyZWFkeSBjb21wbGV0ZWQgd2hlbiByZWNvcmRDcmVhdGlvblxuXHRcdC8vIGZpcmVkICh0aGUgaG9vayBtb21lbnQgSVMgdGhlIGNvbXBsZXRpb24pLCBzbyB0aGUgc3BhbiBzdGFydHMgYW5kXG5cdFx0Ly8gZW5kcyBoZXJlIOKAlCBzYW1lIHNoYXBlIGFzIHJlY29udGV4dC4gZmluZFBhcmVudFNwYW4gYWRvcHRzIHRoZVxuXHRcdC8vIHdyYXBwZWQgY2FsbCdzIHNwYW4gdmlhIGVkZ2UucGFyZW50SWQsIG9yIHRoZSBhY3RpdmUgcmVxdWVzdCBzcGFuIGF0XG5cdFx0Ly8gYSBib3VuZGFyeSwgc28gY29uc3RydWN0aW9ucyBqb2luIHRoZSByZXF1ZXN0IHRyYWNlIGluc3RlYWQgb2Zcblx0XHQvLyBvcGVuaW5nIGEgcm9vdCB0cmFjZSBvZiB0aGVpciBvd24uXG5cdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oZWRnZSk7XG5cdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0PyB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBwYXJlbnRTcGFuKVxuXHRcdFx0OiB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgbmFtZSA9IGBkaXZlLiR7ZWRnZS5raW5kfToke2VkZ2UubmFtZX1gO1xuXHRcdGNvbnN0IHNwYW4gPSBjdHhcblx0XHRcdD8gdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUsIHt9LCBjdHgpXG5cdFx0XHQ6IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmVkZ2VfaWQnLCBlZGdlLmlkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5raW5kJywgZWRnZS5raW5kKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5uYW1lJywgZWRnZS5uYW1lKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5zdGF0dXMnLCBlZGdlLnN0YXR1cyk7XG5cdFx0aWYgKGVkZ2UuZHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZHVyYXRpb25fbXMnLCBlZGdlLmR1cmF0aW9uKTtcblx0XHR9XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cdFx0aWYgKGVkZ2Uuc3RhdHVzID09PSAnZXJyb3InKSB7XG5cdFx0XHRzcGFuLnNldFN0YXR1cyh7IGNvZGU6IFNwYW5TdGF0dXNDb2RlLkVSUk9SIH0pO1xuXHRcdFx0aWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRcdFx0c3Bhbi5yZWNvcmRFeGNlcHRpb24oZXJyb3IpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRzcGFuLmVuZCgpO1xuXHR9XG5cblx0cHJpdmF0ZSBmaW5kUGFyZW50U3BhbiAoZWRnZTogRmxvd0VkZ2UpOiBTcGFuIHwgdW5kZWZpbmVkIHtcdFx0aWYgKGVkZ2UucGFyZW50SWQgIT09IG51bGwpIHtcblx0XHRcdGNvbnN0IG93biA9IHRoaXMuc3BhbnMuZ2V0KGVkZ2UucGFyZW50SWQpO1xuXHRcdFx0aWYgKG93bikge1xuXHRcdFx0XHRyZXR1cm4gb3duO1xuXHRcdFx0fVxuXHRcdH1cblx0XHQvLyBCb3VuZGFyeSAob3IgZXZpY3RlZCBwYXJlbnQpOiBhZG9wdCB0aGUgYWN0aXZlIE9UZWwgc3BhbiDigJQgdGhlIEhUVFBcblx0XHQvLyByZXF1ZXN0IHNwYW4gYmVjb21lcyB0aGUgcm9vdCBvZiB0aGUgZGl2ZSBicmFuY2guXG5cdFx0Y29uc3QgYWN0aXZlID0gdHJhY2UuZ2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSk7XG5cdFx0cmV0dXJuIGFjdGl2ZTtcblx0fVxuXG5cdHByaXZhdGUgY2xvc2VTcGFuIChlZGdlOiBGbG93RWRnZSwgZXJyb3I/OiB1bmtub3duKTogdm9pZCB7XG5cdFx0Y29uc3Qgc3BhbiA9IHRoaXMuc3BhbnMuZ2V0KGVkZ2UuaWQpO1xuXHRcdGlmICghc3Bhbikge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLnNwYW5zLmRlbGV0ZShlZGdlLmlkKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLnN0YXR1cycsIGVkZ2Uuc3RhdHVzKTtcblx0XHRpZiAoZWRnZS5kdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5kdXJhdGlvbl9tcycsIGVkZ2UuZHVyYXRpb24pO1xuXHRcdH1cblx0XHRpZiAoZWRnZS5zdGF0dXMgPT09ICdlcnJvcicpIHtcblx0XHRcdC8vIHN5bmMgdGhyb3dzIGNhcnJ5IG5vIGVycm9yIHZhbHVlIGluIHRoZSBsZWF2ZSBwYXlsb2FkIOKAlCB0aGVcblx0XHRcdC8vIGVkZ2UncyBvd24gc3RhdHVzIGlzIHRoZSB0cnV0aGZ1bCBzaWduYWw7IHRoZSBleGNlcHRpb24gcmVjb3JkXG5cdFx0XHQvLyBpcyBhdmFpbGFibGUgb25seSB3aGVuIHNldHRsZSBjYXJyaWVkIHRoZSByZWplY3Rpb24gaXRzZWxmXG5cdFx0XHRzcGFuLnNldFN0YXR1cyh7IGNvZGU6IFNwYW5TdGF0dXNDb2RlLkVSUk9SIH0pO1xuXHRcdFx0aWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRcdFx0c3Bhbi5yZWNvcmRFeGNlcHRpb24oZXJyb3IpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRzcGFuLmVuZCgpO1xuXHR9XG5cblx0Ly8gUmVnaXN0ZXIgYW4gZWRnZSBmb3IgcmVsZWFzZSBvbmNlLCB0aGUgZmlyc3QgdGltZSB0aGUgcHJvdmlkZXIgc2VlcyBpdC5cblx0cHJpdmF0ZSB0cmFjayAoZWRnZTogRmxvd0VkZ2UpOiB2b2lkIHtcblx0XHRjb25zdCBrbm93biA9IHRoaXMuZWRnZVJlZnMuZ2V0KGVkZ2UuaWQpO1xuXHRcdGlmIChrbm93biAmJiBrbm93bi5kZXJlZigpID09PSBlZGdlKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZWRnZVJlZnMuc2V0KGVkZ2UuaWQsIG5ldyBXZWFrUmVmKGVkZ2UpKTtcblx0XHR0aGlzLnJlbGVhc2VkLnJlZ2lzdGVyKGVkZ2UsIGVkZ2UuaWQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIENyb3NzLXN1cmZhY2UgYXR0cmlidXRlcyBldmVyeSBzcGFuIGdldHMsIG9uIGV2ZXJ5IGhvb2sgcGF0aDpcblx0ICogdGhlIGVkZ2UncyB0cmFjZSByb290IGlkIChKYWVnZXIgbGluayDihpIgbW5lbW9ncmFwaGljYSdzIExpdmUgVHJhY2UpLFxuXHQgKiB0aGUgZWRnZUlk4oaSdHJhY2VJZCBwdWJsaWNhdGlvbiBmb3IgdGhlIHN0cmF0ZWd5IHB1c2ggY2hhbm5lbCwgYW5kXG5cdCAqIGNvZGUuZmlsZXBhdGgvbGluZS9jb2x1bW4gcGFyc2VkIGZyb20gdGhlIGNhbGxzaXRlIG5hbWUuXG5cdCAqL1xuXHRwcml2YXRlIGRlY29yYXRlU3BhbiAoc3BhbjogU3BhbiwgZWRnZTogRmxvd0VkZ2UpOiB2b2lkIHtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5yb290X2VkZ2VfaWQnLCB0aGlzLnJvb3RFZGdlSWRPZihlZGdlKSk7XG5cdFx0cmVjb3JkRWRnZVRyYWNlKGVkZ2UuaWQsIHNwYW4uc3BhbkNvbnRleHQoKS50cmFjZUlkKTtcblx0XHRpZiAoZWRnZS5raW5kICE9PSAnY2FsbCcgJiYgZWRnZS5raW5kICE9PSAnbWV0aG9kJyAmJiBlZGdlLmtpbmQgIT09ICdjb25zdHJ1Y3QnKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IG1hdGNoID0gQ0FMTFNJVEVfUkUuZXhlYyhlZGdlLm5hbWUpO1xuXHRcdGlmICghbWF0Y2gpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUuZmlsZXBhdGgnLCBtYXRjaFsxXSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUubGluZW5vJywgTnVtYmVyKG1hdGNoWzJdKSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUuY29sdW1uJywgTnVtYmVyKG1hdGNoWzNdKSk7XG5cdH1cblxuXHQvLyBXYWxrIGRpdmUncyBwYXJlbnRhZ2UgdG8gdGhlIHJvb3QgZWRnZSBpZC4gUGFyZW50cyBhcmUgcmVjb3JkZWQgYXNcblx0Ly8gZWRnZXMgYXJyaXZlIChlbnRlciBmaXJlcyBwYXJlbnQtYmVmb3JlLWNoaWxkKSwgc28gdGhlIGNoYWluIGlzXG5cdC8vIGNvbXBsZXRlIGZvciBhbnl0aGluZyBzdGlsbCBpbiBmbGlnaHQ7IGFuIGV2aWN0ZWQvdW5rbm93biBwYXJlbnRcblx0Ly8gc2ltcGx5IGVuZHMgdGhlIHdhbGsgYXQgdGhlIGRlZXBlc3Qga25vd24gaWQuXG5cdHByaXZhdGUgcm9vdEVkZ2VJZE9mIChlZGdlOiBGbG93RWRnZSk6IG51bWJlciB7XG5cdFx0dGhpcy50cmFjayhlZGdlKTtcblx0XHR0aGlzLmVkZ2VQYXJlbnRzLnNldChlZGdlLmlkLCBlZGdlLnBhcmVudElkKTtcblx0XHRsZXQgaWQgPSBlZGdlLmlkO1xuXHRcdGxldCBwYXJlbnQgPSBlZGdlLnBhcmVudElkO1xuXHRcdGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oW2lkXSk7XG5cdFx0d2hpbGUgKHBhcmVudCAhPT0gbnVsbCAmJiAhc2Vlbi5oYXMocGFyZW50KSkge1xuXHRcdFx0c2Vlbi5hZGQocGFyZW50KTtcblx0XHRcdGlkID0gcGFyZW50O1xuXHRcdFx0Y29uc3QgbmV4dCA9IHRoaXMuZWRnZVBhcmVudHMuZ2V0KHBhcmVudCk7XG5cdFx0XHRwYXJlbnQgPSBuZXh0ID09PSB1bmRlZmluZWQgPyBudWxsIDogbmV4dDtcblx0XHR9XG5cdFx0cmV0dXJuIGlkO1xuXHR9XG59XG4iXX0=