"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiveOtelProvider = void 0;
const api_1 = require("@opentelemetry/api");
const dive_1 = require("@mnemonica/dive");
// Call/method/construct edges carry their callsite as `name`
// (`/abs/file.ts:line:col`, 1-based) — surfaced as OTEL semconv code.*
// attributes so Jaeger can link straight to the source (Wanted #4).
const CALLSITE_RE = /^(.*):(\d+):(\d+)$/;
// Wanted #2 (2026-09-01): the strategy push channel (an injected script,
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
    // count. dive hands the hooks the very edge objects its ring holds; when
    // the ring lets one go (setTraceLimit eviction, clear()) and it is
    // collected, its entry is released. The WeakRef guards id reuse:
    // dive's clear() restarts ids at 1, so an id may already name a newer,
    // live edge when an old edge's release arrives — that entry stays.
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
     * the edge's trace root id (Jaeger link → mnemographica's Live Trace,
     * Wanted #1), the edgeId→traceId publication for the strategy push
     * channel (Wanted #2), and code.filepath/line/column parsed from the
     * callsite name (Wanted #4).
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGl2ZS1vdGVsLnByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBb0JBLDRDQUFtRjtBQUNuRiwwQ0FReUI7QUFFekIsNkRBQTZEO0FBQzdELHVFQUF1RTtBQUN2RSxvRUFBb0U7QUFDcEUsTUFBTSxXQUFXLEdBQUcsb0JBQW9CLENBQUM7QUFFekMseUVBQXlFO0FBQ3pFLHVFQUF1RTtBQUN2RSx1RUFBdUU7QUFDdkUsdUVBQXVFO0FBQ3ZFLHVFQUF1RTtBQUN2RSwrQkFBK0I7QUFDL0IsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLENBQUM7QUFFaEMsU0FBUyxZQUFZO0lBQ3BCLE1BQU0sQ0FBQyxHQUFHLFVBQXdELENBQUM7SUFDbkUsSUFBSSxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1FBQ2hDLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFDRCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsdUJBQXVCLENBQUM7SUFDdEMsT0FBTyxHQUFHLENBQUM7QUFDWixDQUFDO0FBQ0QsU0FBUyxlQUFlLENBQUUsTUFBYyxFQUFFLE9BQWU7SUFDeEQsTUFBTSxHQUFHLEdBQUcsWUFBWSxFQUFFLENBQUM7SUFDM0IsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDckIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNwQixDQUFDO1NBQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLGlCQUFpQixFQUFFLENBQUM7UUFDMUMsbUVBQW1FO1FBQ25FLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUks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LENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM3QyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ2pCLElBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7UUFDM0IsTUFBTSxJQUFJLEdBQUcsSUFBSSxHQUFHLENBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ25DLE9BQU8sTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ2pCLEVBQUUsR0FBRyxNQUFNLENBQUM7WUFDWixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUMxQyxNQUFNLEdBQUcsSUFBSSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDM0MsQ0FBQztRQUNELE9BQU8sRUFBRSxDQUFDO0lBQ1gsQ0FBQztDQUNEO0FBcFBELDRDQW9QQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT3BlblRlbGVtZXRyeSBwcm92aWRlciBmb3IgZGl2ZSdzIGVkZ2UgbGlmZWN5Y2xlIGhvb2tzLlxuICpcbiAqIFdoZXJlIE1uZW1vbmljYU90ZWxQcm92aWRlciBzcGFucyBDT05TVFJVQ1RJT05TIChtbmVtb25pY2EgaG9va3MpLCB0aGlzXG4gKiBwcm92aWRlciBzcGFucyBFVkVSWSBXUkFQUEVEIENBTEwgKGRpdmUgaG9va3MpOiBjYWxsIC8gY29uc3RydWN0IC8gbWV0aG9kIC9cbiAqIHJlY29udGV4dCBlZGdlcyBlYWNoIGJlY29tZSBhIHNwYW4sIHBhcmVudGVkIG9uIHRoZSBzcGFuIG9mIHRoZSBlZGdlJ3NcbiAqIHBhcmVudElkIOKAlCBkaXZlJ3Mgb3duIHRyYWNlIHBhcmVudGFnZSwgbm90IEFMUy4gQXQgdW53cmFwcGVkIGJvdW5kYXJpZXNcbiAqIChwYXJlbnRJZCBudWxsKSB0aGUgc3BhbiBhZG9wdHMgdGhlIGN1cnJlbnRseSBBQ1RJVkUgT1RlbCBzcGFuIGFzIHBhcmVudCxcbiAqIHNvIGFuXG4gKiBIVFRQIHJlcXVlc3Qgc3BhbiBhZG9wdHMgdGhlIHdob2xlIGRpdmUgYnJhbmNoLiAnY3JlYXRlJyBlZGdlcyAobW5lbW9uaWNhXG4gKiBjb25zdHJ1Y3Rpb25zIHJlY29yZGVkIHZpYSByZWNvcmRDcmVhdGlvbi9yZWNvcmRDcmVhdGlvbkVycm9yKSBiZWNvbWVcbiAqIG9uZS1zaG90IHNwYW5zIG9uIHRoZSBzYW1lIHBhcmVudGFnZSDigJQgdGhlIGNvbnN0cnVjdGlvbiBIQVMgY29tcGxldGVkIHdoZW5cbiAqIHRoZSBob29rIGZpcmVzLCBzbyB0aGUgc3BhbiBzdGFydHMgYW5kIGVuZHMgaW5zaWRlIHRoZSBoYW5kbGVyLlxuICpcbiAqIEFzeW5jIHRydXRoZnVsbmVzczogYSBzcGFuIGRvZXMgTk9UIGVuZCBhdCB0aGUgc3luYyBjbG9zZSB3aGVuIHRoZSB3cmFwXG4gKiBwcm9kdWNlZCBhIHRhcHBlZCBwcm9taXNlIOKAlCBpdCBlbmRzIGF0IHNldHRsZSwgd2l0aCB0aGUgY2hhaW4ncyBvdXRjb21lLlxuICogU3BhbnMgYXJlIGtleWVkIG9uIGVkZ2UgaWQ7IGV2ZXJ5IHJlY29yZGVkIGVkZ2UgZmlyZXMgbGVhdmUgKGFuZCwgd2hlblxuICogYXN5bmMsIHNldHRsZSksIHNvIHRoZSBtYXAgYWx3YXlzIGRyYWlucy5cbiAqL1xuaW1wb3J0IHR5cGUgeyBTcGFuLCBUcmFjZXIgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHsgU3BhblN0YXR1c0NvZGUsIGNvbnRleHQgYXMgb3RlbENvbnRleHQsIHRyYWNlIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB7XG5cdHJlZ2lzdGVySG9vayxcblx0dHlwZSBEaXZlQ3JlYXRlUGF5bG9hZCxcblx0dHlwZSBEaXZlRW50ZXJQYXlsb2FkLFxuXHR0eXBlIERpdmVMZWF2ZVBheWxvYWQsXG5cdHR5cGUgRGl2ZVJlY29udGV4dFBheWxvYWQsXG5cdHR5cGUgRGl2ZVNldHRsZVBheWxvYWQsXG5cdHR5cGUgRmxvd0VkZ2UsXG59IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5cbi8vIENhbGwvbWV0aG9kL2NvbnN0cnVjdCBlZGdlcyBjYXJyeSB0aGVpciBjYWxsc2l0ZSBhcyBgbmFtZWBcbi8vIChgL2Ficy9maWxlLnRzOmxpbmU6Y29sYCwgMS1iYXNlZCkg4oCUIHN1cmZhY2VkIGFzIE9URUwgc2VtY29udiBjb2RlLipcbi8vIGF0dHJpYnV0ZXMgc28gSmFlZ2VyIGNhbiBsaW5rIHN0cmFpZ2h0IHRvIHRoZSBzb3VyY2UgKFdhbnRlZCAjNCkuXG5jb25zdCBDQUxMU0lURV9SRSA9IC9eKC4qKTooXFxkKyk6KFxcZCspJC87XG5cbi8vIFdhbnRlZCAjMiAoMjAyNi0wOS0wMSk6IHRoZSBzdHJhdGVneSBwdXNoIGNoYW5uZWwgKGFuIGluamVjdGVkIHNjcmlwdCxcbi8vIHNlZSBzdHJhdGVneS9jZHAtc2NyaXB0cy93cy1zZXJ2ZXIuanMpIGNhbm5vdCBzZWUgT1RFTCBzcGFucywgc28gdGhlXG4vLyBhZGFwdGVyIHB1Ymxpc2hlcyBlZGdlSWQg4oaSIHRyYWNlSWQgb24gYSBib3VuZGVkIGdsb2JhbCBtYXA7IHRoZSBwdXNoXG4vLyBtYXBwZXIgZm9yd2FyZHMgaXQgYW5kIG1uZW1vZ3JhcGhpY2EncyBMaXZlIFRyYWNlIGdhaW5zIHRoZSBcIk9wZW4gaW5cbi8vIEphZWdlclwiIGp1bXAuIGdsb2JhbFRoaXMgYmVjYXVzZSBhZGFwdGVyIGFuZCBpbmplY3RlZCBzY3JpcHQgc2hhcmUgYVxuLy8gcHJvY2Vzcywgbm90IGEgbW9kdWxlIGdyYXBoLlxuY29uc3QgRURHRV9UUkFDRVNfTElNSVQgPSAxMDAwMDtcbnR5cGUgRWRnZVRyYWNlTWFwID0gTWFwPG51bWJlciwgc3RyaW5nPjtcbmZ1bmN0aW9uIGVkZ2VUcmFjZU1hcCAoKTogRWRnZVRyYWNlTWFwIHtcblx0Y29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgeyBfX21uZW1vbmljYURpdmVUcmFjZUlkcz86IEVkZ2VUcmFjZU1hcCB9O1xuXHRpZiAoIWcuX19tbmVtb25pY2FEaXZlVHJhY2VJZHMpIHtcblx0XHRnLl9fbW5lbW9uaWNhRGl2ZVRyYWNlSWRzID0gbmV3IE1hcCgpO1xuXHR9XG5cdGNvbnN0IG1hcCA9IGcuX19tbmVtb25pY2FEaXZlVHJhY2VJZHM7XG5cdHJldHVybiBtYXA7XG59XG5mdW5jdGlvbiByZWNvcmRFZGdlVHJhY2UgKGVkZ2VJZDogbnVtYmVyLCB0cmFjZUlkOiBzdHJpbmcpOiB2b2lkIHtcblx0Y29uc3QgbWFwID0gZWRnZVRyYWNlTWFwKCk7XG5cdGlmIChtYXAuaGFzKGVkZ2VJZCkpIHtcblx0XHRtYXAuZGVsZXRlKGVkZ2VJZCk7XG5cdH0gZWxzZSBpZiAobWFwLnNpemUgPj0gRURHRV9UUkFDRVNfTElNSVQpIHtcblx0XHQvLyBGSUZPOiB0aGUgb2xkZXN0IGVudHJ5IGRpZXMgZmlyc3Qg4oCUIE1hcCBpdGVyYXRlcyBpbnNlcnRpb24gb3JkZXJcblx0XHRjb25zdCBvbGRlc3QgPSBtYXAua2V5cygpLm5leHQoKTtcblx0XHRpZiAoIW9sZGVzdC5kb25lKSB7XG5cdFx0XHRtYXAuZGVsZXRlKG9sZGVzdC52YWx1ZSk7XG5cdFx0fVxuXHR9XG5cdG1hcC5zZXQoZWRnZUlkLCB0cmFjZUlkKTtcbn1cblxuZXhwb3J0IGNsYXNzIERpdmVPdGVsUHJvdmlkZXIge1xuXHRwcml2YXRlIHRyYWNlcjogVHJhY2VyO1xuXHQvLyBvcGVuIHNwYW5zLCBrZXllZCBvbiBkaXZlIGVkZ2UgaWQg4oCUIGRyYWluZWQgYnkgbGVhdmUvc2V0dGxlXG5cdHByaXZhdGUgc3BhbnMgPSBuZXcgTWFwPG51bWJlciwgU3Bhbj4oKTtcblx0Ly8gZWRnZSBpZCDihpIgcGFyZW50SWQsIGZvciB0aGUgcm9vdC1lZGdlIHdhbGsgKGRpdmUucm9vdF9lZGdlX2lkIHNwYW5cblx0Ly8gYXR0cmlidXRlKS4gTmV2ZXIgZHJhaW5lZCBtaWQtZmxpZ2h0OiBhIGNvbXBsZXRlZCBlZGdlIGNhbiBzdGlsbFxuXHQvLyBwYXJlbnQgbGF0ZXIgY2hpbGRyZW4gKGEgY3JlYXRlIGVkZ2UgYWRvcHRzIHRoZSBuZXh0IHdyYXBwZWQgY2FsbCkuXG5cdHByaXZhdGUgZWRnZVBhcmVudHMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyIHwgbnVsbD4oKTtcblx0Ly8gUGVyLWVkZ2UgbWVtb3J5IGxpdmVzIGV4YWN0bHkgYXMgbG9uZyBhcyBkaXZlIHJldGFpbnMgdGhlIGVkZ2Ug4oCUIG5vXG5cdC8vIGNvdW50LiBkaXZlIGhhbmRzIHRoZSBob29rcyB0aGUgdmVyeSBlZGdlIG9iamVjdHMgaXRzIHJpbmcgaG9sZHM7IHdoZW5cblx0Ly8gdGhlIHJpbmcgbGV0cyBvbmUgZ28gKHNldFRyYWNlTGltaXQgZXZpY3Rpb24sIGNsZWFyKCkpIGFuZCBpdCBpc1xuXHQvLyBjb2xsZWN0ZWQsIGl0cyBlbnRyeSBpcyByZWxlYXNlZC4gVGhlIFdlYWtSZWYgZ3VhcmRzIGlkIHJldXNlOlxuXHQvLyBkaXZlJ3MgY2xlYXIoKSByZXN0YXJ0cyBpZHMgYXQgMSwgc28gYW4gaWQgbWF5IGFscmVhZHkgbmFtZSBhIG5ld2VyLFxuXHQvLyBsaXZlIGVkZ2Ugd2hlbiBhbiBvbGQgZWRnZSdzIHJlbGVhc2UgYXJyaXZlcyDigJQgdGhhdCBlbnRyeSBzdGF5cy5cblx0cHJpdmF0ZSBlZGdlUmVmcyA9IG5ldyBNYXA8bnVtYmVyLCBXZWFrUmVmPEZsb3dFZGdlPj4oKTtcblx0cHJpdmF0ZSByZWxlYXNlZCA9IG5ldyBGaW5hbGl6YXRpb25SZWdpc3RyeTxudW1iZXI+KChlZGdlSWQpID0+IHtcblx0XHRjb25zdCByZWYgPSB0aGlzLmVkZ2VSZWZzLmdldChlZGdlSWQpO1xuXHRcdGlmIChyZWYgJiYgcmVmLmRlcmVmKCkgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmVkZ2VSZWZzLmRlbGV0ZShlZGdlSWQpO1xuXHRcdHRoaXMuZWRnZVBhcmVudHMuZGVsZXRlKGVkZ2VJZCk7XG5cdH0pO1xuXHRwcml2YXRlIGRldGFjaGVyczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuXHRjb25zdHJ1Y3RvciAodHJhY2VyPzogVHJhY2VyKSB7XG5cdFx0dGhpcy50cmFjZXIgPSB0cmFjZXIgPz8gdHJhY2UuZ2V0VHJhY2VyKCdAbW5lbW9uaWNhL290ZWwnKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBTdWJzY3JpYmUgdG8gZGl2ZSdzIGVkZ2UgbGlmZWN5Y2xlLiBJZGVtcG90ZW50OiBhdHRhY2hpbmcgdHdpY2Ugd291bGRcblx0ICogZG91YmxlIGV2ZXJ5IHNwYW4uIERpdmUncyBjbGVhcigpIHdpcGVzIHN1YnNjcmliZXJzIOKAlCByZS1hdHRhY2ggYWZ0ZXIgaXQuXG5cdCAqL1xuXHRhdHRhY2ggKCk6IHZvaWQge1xuXHRcdGlmICh0aGlzLmRldGFjaGVycy5sZW5ndGggPiAwKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHRyZWdpc3Rlckhvb2soJ2VudGVyJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkVudGVyKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0XHRyZWdpc3Rlckhvb2soJ2xlYXZlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkxlYXZlKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0XHRyZWdpc3Rlckhvb2soJ3NldHRsZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25TZXR0bGUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHJlZ2lzdGVySG9vaygncmVjb250ZXh0JywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vblJlY29udGV4dChwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdCk7XG5cdFx0dHJ5IHtcblx0XHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHRcdHJlZ2lzdGVySG9vaygnY3JlYXRlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0XHR0aGlzLm9uQ3JlYXRlKHBheWxvYWQpO1xuXHRcdFx0XHR9KSxcblx0XHRcdCk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBUaGUgJ2NyZWF0ZScgZXZlbnQgZXhpc3RzIHNpbmNlIGRpdmUgMC44LjA7IG9uIDAuNy54IHJlZ2lzdGVySG9va1xuXHRcdFx0Ly8gdGhyb3dzIG9uIHRoZSB1bmtub3duIGV2ZW50LiBTa2lwcGluZyBpdCB0aGVyZSBwcmVzZXJ2ZXMgZXhhY3RseVxuXHRcdFx0Ly8gdGhlIHByZS1zdWJzY3JpcHRpb24gYmVoYXZpb3IgKGNvbnN0cnVjdGlvbnMgc3RheSB1bnNwYW5uZWQpLCBzb1xuXHRcdFx0Ly8gdGhlIHdpZGVuZWQgXjAuNy4wIHx8IF4wLjguMCBwZWVyIHJhbmdlIHN0YXlzIGhvbmVzdC5cblx0XHR9XG5cdH1cblxuXHRkZXRhY2ggKCk6IHZvaWQge1xuXHRcdGZvciAoY29uc3QgZGV0YWNoIG9mIHRoaXMuZGV0YWNoZXJzKSB7XG5cdFx0XHRkZXRhY2goKTtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMgPSBbXTtcblx0fVxuXG5cdHByaXZhdGUgb25FbnRlciAoeyBlZGdlIH06IERpdmVFbnRlclBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBwYXJlbnRTcGFuID0gdGhpcy5maW5kUGFyZW50U3BhbihlZGdlKTtcblx0XHRjb25zdCBjdHggPSBwYXJlbnRTcGFuXG5cdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHQ6IHVuZGVmaW5lZDtcblx0XHRjb25zdCBuYW1lID0gYGRpdmUuJHtlZGdlLmtpbmR9OiR7ZWRnZS5uYW1lfWA7XG5cdFx0Y29uc3Qgc3BhbiA9IGN0eFxuXHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSwge30sIGN0eClcblx0XHRcdDogdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUpO1xuXG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZWRnZV9pZCcsIGVkZ2UuaWQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmtpbmQnLCBlZGdlLmtpbmQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLm5hbWUnLCBlZGdlLm5hbWUpO1xuXHRcdHRoaXMuZGVjb3JhdGVTcGFuKHNwYW4sIGVkZ2UpO1xuXG5cdFx0dGhpcy5zcGFucy5zZXQoZWRnZS5pZCwgc3Bhbik7XG5cdH1cblxuXHRwcml2YXRlIG9uTGVhdmUgKHsgZWRnZSwgcmVzdWx0IH06IERpdmVMZWF2ZVBheWxvYWQpOiB2b2lkIHtcblx0XHRpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuXHRcdFx0Ly8gYXN5bmMgd29yazogdGhlIHNwYW4gY2xvc2VzIGF0IHNldHRsZSwgbm90IGF0IHRoZSBzeW5jIGhlYWQg4oCUXG5cdFx0XHQvLyBcInRoZSBmdW5jdGlvbiByZXR1cm5lZFwiIGlzIG5vdCBcInRoZSB3b3JrIGlzIGRvbmVcIlxuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmNsb3NlU3BhbihlZGdlKTtcblx0fVxuXG5cdHByaXZhdGUgb25TZXR0bGUgKHsgZWRnZSwgZXJyb3IgfTogRGl2ZVNldHRsZVBheWxvYWQpOiB2b2lkIHtcblx0XHR0aGlzLmNsb3NlU3BhbihlZGdlLCBlcnJvcik7XG5cdH1cblxuXHRwcml2YXRlIG9uUmVjb250ZXh0ICh7IGVkZ2UsIHByZXZpb3VzQ29udGV4dCwgY29udGV4dCB9OiBEaXZlUmVjb250ZXh0UGF5bG9hZCk6IHZvaWQge1xuXHRcdC8vIE9uZS1zaG90IHNwYW46IHRoZSBvd25lcnNoaXAgdHJhbnNmZXIgaXRzZWxmLCBwYXJlbnRlZCBvbiB0aGUgT0xEXG5cdFx0Ly8gY29udGV4dCdzIHNwYW4gKHRoZSBoYW5kb2ZmIGVkZ2UncyBwYXJlbnRJZCksIHNvIHRoZSB0cmFjZSBzaG93c1xuXHRcdC8vIHdoZXJlIHRoZSBjYWxsYmFjaydzIHN0b3J5IGNyb3NzZWQgZmxvd3MuXG5cdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oZWRnZSk7XG5cdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0PyB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBwYXJlbnRTcGFuKVxuXHRcdFx0OiB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgbmFtZSA9IGBkaXZlLiR7ZWRnZS5raW5kfToke2VkZ2UubmFtZX1gO1xuXHRcdGNvbnN0IHNwYW4gPSBjdHhcblx0XHRcdD8gdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUsIHt9LCBjdHgpXG5cdFx0XHQ6IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmVkZ2VfaWQnLCBlZGdlLmlkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5raW5kJywgZWRnZS5raW5kKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5uYW1lJywgZWRnZS5uYW1lKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmJywgdHJ1ZSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuaGFuZG9mZi5oYWRfcHJldmlvdXMnLCBwcmV2aW91c0NvbnRleHQgIT09IHVuZGVmaW5lZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuaGFuZG9mZi5oYXNfY29udGV4dCcsIGNvbnRleHQgIT09IHVuZGVmaW5lZCk7XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdHByaXZhdGUgb25DcmVhdGUgKHsgZWRnZSwgZXJyb3IgfTogRGl2ZUNyZWF0ZVBheWxvYWQpOiB2b2lkIHtcblx0XHQvLyBPbmUtc2hvdCBzcGFuOiB0aGUgY29uc3RydWN0aW9uIGFscmVhZHkgY29tcGxldGVkIHdoZW4gcmVjb3JkQ3JlYXRpb25cblx0XHQvLyBmaXJlZCAodGhlIGhvb2sgbW9tZW50IElTIHRoZSBjb21wbGV0aW9uKSwgc28gdGhlIHNwYW4gc3RhcnRzIGFuZFxuXHRcdC8vIGVuZHMgaGVyZSDigJQgc2FtZSBzaGFwZSBhcyByZWNvbnRleHQuIGZpbmRQYXJlbnRTcGFuIGFkb3B0cyB0aGVcblx0XHQvLyB3cmFwcGVkIGNhbGwncyBzcGFuIHZpYSBlZGdlLnBhcmVudElkLCBvciB0aGUgYWN0aXZlIHJlcXVlc3Qgc3BhbiBhdFxuXHRcdC8vIGEgYm91bmRhcnksIHNvIGNvbnN0cnVjdGlvbnMgam9pbiB0aGUgcmVxdWVzdCB0cmFjZSBpbnN0ZWFkIG9mXG5cdFx0Ly8gb3BlbmluZyBhIHJvb3QgdHJhY2Ugb2YgdGhlaXIgb3duLlxuXHRcdGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmZpbmRQYXJlbnRTcGFuKGVkZ2UpO1xuXHRcdGNvbnN0IGN0eCA9IHBhcmVudFNwYW5cblx0XHRcdD8gdHJhY2Uuc2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSwgcGFyZW50U3Bhbilcblx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdGNvbnN0IG5hbWUgPSBgZGl2ZS4ke2VkZ2Uua2luZH06JHtlZGdlLm5hbWV9YDtcblx0XHRjb25zdCBzcGFuID0gY3R4XG5cdFx0XHQ/IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lLCB7fSwgY3R4KVxuXHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5lZGdlX2lkJywgZWRnZS5pZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUua2luZCcsIGVkZ2Uua2luZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUubmFtZScsIGVkZ2UubmFtZSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuc3RhdHVzJywgZWRnZS5zdGF0dXMpO1xuXHRcdGlmIChlZGdlLmR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmR1cmF0aW9uX21zJywgZWRnZS5kdXJhdGlvbik7XG5cdFx0fVxuXHRcdHRoaXMuZGVjb3JhdGVTcGFuKHNwYW4sIGVkZ2UpO1xuXHRcdGlmIChlZGdlLnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuXHRcdFx0c3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBTcGFuU3RhdHVzQ29kZS5FUlJPUiB9KTtcblx0XHRcdGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG5cdFx0XHRcdHNwYW4ucmVjb3JkRXhjZXB0aW9uKGVycm9yKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdHByaXZhdGUgZmluZFBhcmVudFNwYW4gKGVkZ2U6IEZsb3dFZGdlKTogU3BhbiB8IHVuZGVmaW5lZCB7XHRcdGlmIChlZGdlLnBhcmVudElkICE9PSBudWxsKSB7XG5cdFx0XHRjb25zdCBvd24gPSB0aGlzLnNwYW5zLmdldChlZGdlLnBhcmVudElkKTtcblx0XHRcdGlmIChvd24pIHtcblx0XHRcdFx0cmV0dXJuIG93bjtcblx0XHRcdH1cblx0XHR9XG5cdFx0Ly8gQm91bmRhcnkgKG9yIGV2aWN0ZWQgcGFyZW50KTogYWRvcHQgdGhlIGFjdGl2ZSBPVGVsIHNwYW4g4oCUIHRoZSBIVFRQXG5cdFx0Ly8gcmVxdWVzdCBzcGFuIGJlY29tZXMgdGhlIHJvb3Qgb2YgdGhlIGRpdmUgYnJhbmNoLlxuXHRcdGNvbnN0IGFjdGl2ZSA9IHRyYWNlLmdldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCkpO1xuXHRcdHJldHVybiBhY3RpdmU7XG5cdH1cblxuXHRwcml2YXRlIGNsb3NlU3BhbiAoZWRnZTogRmxvd0VkZ2UsIGVycm9yPzogdW5rbm93bik6IHZvaWQge1xuXHRcdGNvbnN0IHNwYW4gPSB0aGlzLnNwYW5zLmdldChlZGdlLmlkKTtcblx0XHRpZiAoIXNwYW4pIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5zcGFucy5kZWxldGUoZWRnZS5pZCk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5zdGF0dXMnLCBlZGdlLnN0YXR1cyk7XG5cdFx0aWYgKGVkZ2UuZHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZHVyYXRpb25fbXMnLCBlZGdlLmR1cmF0aW9uKTtcblx0XHR9XG5cdFx0aWYgKGVkZ2Uuc3RhdHVzID09PSAnZXJyb3InKSB7XG5cdFx0XHQvLyBzeW5jIHRocm93cyBjYXJyeSBubyBlcnJvciB2YWx1ZSBpbiB0aGUgbGVhdmUgcGF5bG9hZCDigJQgdGhlXG5cdFx0XHQvLyBlZGdlJ3Mgb3duIHN0YXR1cyBpcyB0aGUgdHJ1dGhmdWwgc2lnbmFsOyB0aGUgZXhjZXB0aW9uIHJlY29yZFxuXHRcdFx0Ly8gaXMgYXZhaWxhYmxlIG9ubHkgd2hlbiBzZXR0bGUgY2FycmllZCB0aGUgcmVqZWN0aW9uIGl0c2VsZlxuXHRcdFx0c3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBTcGFuU3RhdHVzQ29kZS5FUlJPUiB9KTtcblx0XHRcdGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG5cdFx0XHRcdHNwYW4ucmVjb3JkRXhjZXB0aW9uKGVycm9yKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdC8vIFJlZ2lzdGVyIGFuIGVkZ2UgZm9yIHJlbGVhc2Ugb25jZSwgdGhlIGZpcnN0IHRpbWUgdGhlIHByb3ZpZGVyIHNlZXMgaXQuXG5cdHByaXZhdGUgdHJhY2sgKGVkZ2U6IEZsb3dFZGdlKTogdm9pZCB7XG5cdFx0Y29uc3Qga25vd24gPSB0aGlzLmVkZ2VSZWZzLmdldChlZGdlLmlkKTtcblx0XHRpZiAoa25vd24gJiYga25vd24uZGVyZWYoKSA9PT0gZWRnZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmVkZ2VSZWZzLnNldChlZGdlLmlkLCBuZXcgV2Vha1JlZihlZGdlKSk7XG5cdFx0dGhpcy5yZWxlYXNlZC5yZWdpc3RlcihlZGdlLCBlZGdlLmlkKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBDcm9zcy1zdXJmYWNlIGF0dHJpYnV0ZXMgZXZlcnkgc3BhbiBnZXRzLCBvbiBldmVyeSBob29rIHBhdGg6XG5cdCAqIHRoZSBlZGdlJ3MgdHJhY2Ugcm9vdCBpZCAoSmFlZ2VyIGxpbmsg4oaSIG1uZW1vZ3JhcGhpY2EncyBMaXZlIFRyYWNlLFxuXHQgKiBXYW50ZWQgIzEpLCB0aGUgZWRnZUlk4oaSdHJhY2VJZCBwdWJsaWNhdGlvbiBmb3IgdGhlIHN0cmF0ZWd5IHB1c2hcblx0ICogY2hhbm5lbCAoV2FudGVkICMyKSwgYW5kIGNvZGUuZmlsZXBhdGgvbGluZS9jb2x1bW4gcGFyc2VkIGZyb20gdGhlXG5cdCAqIGNhbGxzaXRlIG5hbWUgKFdhbnRlZCAjNCkuXG5cdCAqL1xuXHRwcml2YXRlIGRlY29yYXRlU3BhbiAoc3BhbjogU3BhbiwgZWRnZTogRmxvd0VkZ2UpOiB2b2lkIHtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5yb290X2VkZ2VfaWQnLCB0aGlzLnJvb3RFZGdlSWRPZihlZGdlKSk7XG5cdFx0cmVjb3JkRWRnZVRyYWNlKGVkZ2UuaWQsIHNwYW4uc3BhbkNvbnRleHQoKS50cmFjZUlkKTtcblx0XHRpZiAoZWRnZS5raW5kICE9PSAnY2FsbCcgJiYgZWRnZS5raW5kICE9PSAnbWV0aG9kJyAmJiBlZGdlLmtpbmQgIT09ICdjb25zdHJ1Y3QnKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IG1hdGNoID0gQ0FMTFNJVEVfUkUuZXhlYyhlZGdlLm5hbWUpO1xuXHRcdGlmICghbWF0Y2gpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUuZmlsZXBhdGgnLCBtYXRjaFsxXSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUubGluZW5vJywgTnVtYmVyKG1hdGNoWzJdKSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUuY29sdW1uJywgTnVtYmVyKG1hdGNoWzNdKSk7XG5cdH1cblxuXHQvLyBXYWxrIGRpdmUncyBwYXJlbnRhZ2UgdG8gdGhlIHJvb3QgZWRnZSBpZC4gUGFyZW50cyBhcmUgcmVjb3JkZWQgYXNcblx0Ly8gZWRnZXMgYXJyaXZlIChlbnRlciBmaXJlcyBwYXJlbnQtYmVmb3JlLWNoaWxkKSwgc28gdGhlIGNoYWluIGlzXG5cdC8vIGNvbXBsZXRlIGZvciBhbnl0aGluZyBzdGlsbCBpbiBmbGlnaHQ7IGFuIGV2aWN0ZWQvdW5rbm93biBwYXJlbnRcblx0Ly8gc2ltcGx5IGVuZHMgdGhlIHdhbGsgYXQgdGhlIGRlZXBlc3Qga25vd24gaWQuXG5cdHByaXZhdGUgcm9vdEVkZ2VJZE9mIChlZGdlOiBGbG93RWRnZSk6IG51bWJlciB7XG5cdFx0dGhpcy50cmFjayhlZGdlKTtcblx0XHR0aGlzLmVkZ2VQYXJlbnRzLnNldChlZGdlLmlkLCBlZGdlLnBhcmVudElkKTtcblx0XHRsZXQgaWQgPSBlZGdlLmlkO1xuXHRcdGxldCBwYXJlbnQgPSBlZGdlLnBhcmVudElkO1xuXHRcdGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oW2lkXSk7XG5cdFx0d2hpbGUgKHBhcmVudCAhPT0gbnVsbCAmJiAhc2Vlbi5oYXMocGFyZW50KSkge1xuXHRcdFx0c2Vlbi5hZGQocGFyZW50KTtcblx0XHRcdGlkID0gcGFyZW50O1xuXHRcdFx0Y29uc3QgbmV4dCA9IHRoaXMuZWRnZVBhcmVudHMuZ2V0KHBhcmVudCk7XG5cdFx0XHRwYXJlbnQgPSBuZXh0ID09PSB1bmRlZmluZWQgPyBudWxsIDogbmV4dDtcblx0XHR9XG5cdFx0cmV0dXJuIGlkO1xuXHR9XG59XG4iXX0=