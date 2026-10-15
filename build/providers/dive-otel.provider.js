/**
 * OpenTelemetry provider for dive's edge lifecycle hooks.
 *
 * Where MnemonicaOtelProvider spans CONSTRUCTIONS (mnemonica hooks), this
 * provider spans EVERY WRAPPED CALL (dive hooks): call / construct / method /
 * recontext edges each become a span, parented on the span of the edge's
 * parentId — dive's own trace parentage, not ALS. At unwrapped boundaries
 * (parentId null) the span adopts the currently ACTIVE OTel span as parent,
 * so an
 * HTTP request span adopts the whole dive branch. 'create' edges (mnemonica
 * constructions recorded via recordCreation/recordCreationError) become
 * one-shot spans on the same parentage — the construction HAS completed when
 * the hook fires, so the span starts and ends inside the handler.
 *
 * Async truthfulness: a span does NOT end at the sync close when the wrap
 * produced a tapped promise — it ends at settle, with the chain's outcome.
 * Spans are keyed on edge id; every recorded edge fires leave (and, when
 * async, settle), so the map always drains.
 */
import { SpanStatusCode, context as otelContext, trace, } from '@opentelemetry/api';
import { resolveDive, } from '../dive-api.js';
import { ATTR_INSTANCE_ID, instanceRef, } from '../lineage-link.js';
import { isMnemonicaInstance } from '../utils/is-mnemonica-instance.js';
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
export class DiveOtelProvider {
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
    // the dive this provider subscribes to — the default dive unless the
    // caller traces through their own
    dive;
    constructor(tracer, options) {
        this.tracer = tracer ?? trace.getTracer('@mnemonica/otel');
        this.dive = resolveDive(options);
    }
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every span. Dive's clear() wipes subscribers — re-attach after it.
     */
    attach() {
        if (this.detachers.length > 0) {
            return;
        }
        this.detachers.push(this.dive.registerHook('enter', (payload) => {
            this.onEnter(payload);
        }), this.dive.registerHook('leave', (payload) => {
            this.onLeave(payload);
        }), this.dive.registerHook('settle', (payload) => {
            this.onSettle(payload);
        }), this.dive.registerHook('recontext', (payload) => {
            this.onRecontext(payload);
        }), 
        // dive 0.7 support is gone (peer range is ^0.10.3): the 'create'
        // event exists since 0.8.0, subscribe directly
        this.dive.registerHook('create', (payload) => {
            this.onCreate(payload);
        }));
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
            ? trace.setSpan(otelContext.active(), parentSpan)
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
            ? trace.setSpan(otelContext.active(), parentSpan)
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
            ? trace.setSpan(otelContext.active(), parentSpan)
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
        // the same lineage id stampConstructions puts on the span current at
        // construction — a create span and the instance's lineage join on it
        const { instance } = edge;
        if (instance !== undefined && isMnemonicaInstance(instance)) {
            span.setAttribute(ATTR_INSTANCE_ID, instanceRef(instance).id);
        }
        this.decorateSpan(span, edge);
        if (edge.status === 'error') {
            span.setStatus({ code: SpanStatusCode.ERROR });
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
        const active = trace.getSpan(otelContext.active());
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
            span.setStatus({ code: SpanStatusCode.ERROR });
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
        let { id } = edge;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGl2ZS1vdGVsLnByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILE9BQU8sRUFDTixjQUFjLEVBQ2QsT0FBTyxJQUFJLFdBQVcsRUFDdEIsS0FBSyxHQUdMLE1BQU0sb0JBQW9CLENBQUM7QUFDNUIsT0FBTyxFQUNOLFdBQVcsR0FHWCxNQUFNLGdCQUFnQixDQUFDO0FBQ3hCLE9BQU8sRUFDTixnQkFBZ0IsRUFDaEIsV0FBVyxHQUNYLE1BQU0sb0JBQW9CLENBQUM7QUFDNUIsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sbUNBQW1DLENBQUM7QUFVeEUsNkRBQTZEO0FBQzdELHVFQUF1RTtBQUN2RSx3REFBd0Q7QUFDeEQsTUFBTSxXQUFXLEdBQUcsb0JBQW9CLENBQUM7QUFFekMsaURBQWlEO0FBQ2pELHVFQUF1RTtBQUN2RSx1RUFBdUU7QUFDdkUsdUVBQXVFO0FBQ3ZFLHVFQUF1RTtBQUN2RSwrQkFBK0I7QUFDL0IsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLENBQUM7QUFFaEMsU0FBUyxZQUFZO0lBQ3BCLE1BQU0sQ0FBQyxHQUFHLFVBQXdELENBQUM7SUFDbkUsSUFBSSxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1FBQ2hDLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFDRCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsdUJBQXVCLENBQUM7SUFDdEMsT0FBTyxHQUFHLENBQUM7QUFDWixDQUFDO0FBQ0QsU0FBUyxlQUFlLENBQUUsTUFBYyxFQUFFLE9BQWU7SUFDeEQsTUFBTSxHQUFHLEdBQUcsWUFBWSxFQUFFLENBQUM7SUFDM0IsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FB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RyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUMxQyxNQUFNLEdBQUcsSUFBSSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDM0MsQ0FBQztRQUNELE9BQU8sRUFBRSxDQUFDO0lBQ1gsQ0FBQztDQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IHByb3ZpZGVyIGZvciBkaXZlJ3MgZWRnZSBsaWZlY3ljbGUgaG9va3MuXG4gKlxuICogV2hlcmUgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIHNwYW5zIENPTlNUUlVDVElPTlMgKG1uZW1vbmljYSBob29rcyksIHRoaXNcbiAqIHByb3ZpZGVyIHNwYW5zIEVWRVJZIFdSQVBQRUQgQ0FMTCAoZGl2ZSBob29rcyk6IGNhbGwgLyBjb25zdHJ1Y3QgLyBtZXRob2QgL1xuICogcmVjb250ZXh0IGVkZ2VzIGVhY2ggYmVjb21lIGEgc3BhbiwgcGFyZW50ZWQgb24gdGhlIHNwYW4gb2YgdGhlIGVkZ2Unc1xuICogcGFyZW50SWQg4oCUIGRpdmUncyBvd24gdHJhY2UgcGFyZW50YWdlLCBub3QgQUxTLiBBdCB1bndyYXBwZWQgYm91bmRhcmllc1xuICogKHBhcmVudElkIG51bGwpIHRoZSBzcGFuIGFkb3B0cyB0aGUgY3VycmVudGx5IEFDVElWRSBPVGVsIHNwYW4gYXMgcGFyZW50LFxuICogc28gYW5cbiAqIEhUVFAgcmVxdWVzdCBzcGFuIGFkb3B0cyB0aGUgd2hvbGUgZGl2ZSBicmFuY2guICdjcmVhdGUnIGVkZ2VzIChtbmVtb25pY2FcbiAqIGNvbnN0cnVjdGlvbnMgcmVjb3JkZWQgdmlhIHJlY29yZENyZWF0aW9uL3JlY29yZENyZWF0aW9uRXJyb3IpIGJlY29tZVxuICogb25lLXNob3Qgc3BhbnMgb24gdGhlIHNhbWUgcGFyZW50YWdlIOKAlCB0aGUgY29uc3RydWN0aW9uIEhBUyBjb21wbGV0ZWQgd2hlblxuICogdGhlIGhvb2sgZmlyZXMsIHNvIHRoZSBzcGFuIHN0YXJ0cyBhbmQgZW5kcyBpbnNpZGUgdGhlIGhhbmRsZXIuXG4gKlxuICogQXN5bmMgdHJ1dGhmdWxuZXNzOiBhIHNwYW4gZG9lcyBOT1QgZW5kIGF0IHRoZSBzeW5jIGNsb3NlIHdoZW4gdGhlIHdyYXBcbiAqIHByb2R1Y2VkIGEgdGFwcGVkIHByb21pc2Ug4oCUIGl0IGVuZHMgYXQgc2V0dGxlLCB3aXRoIHRoZSBjaGFpbidzIG91dGNvbWUuXG4gKiBTcGFucyBhcmUga2V5ZWQgb24gZWRnZSBpZDsgZXZlcnkgcmVjb3JkZWQgZWRnZSBmaXJlcyBsZWF2ZSAoYW5kLCB3aGVuXG4gKiBhc3luYywgc2V0dGxlKSwgc28gdGhlIG1hcCBhbHdheXMgZHJhaW5zLlxuICovXG5pbXBvcnQge1xuXHRTcGFuU3RhdHVzQ29kZSxcblx0Y29udGV4dCBhcyBvdGVsQ29udGV4dCxcblx0dHJhY2UsXG5cdHR5cGUgU3Bhbixcblx0dHlwZSBUcmFjZXIsXG59IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQge1xuXHRyZXNvbHZlRGl2ZSxcblx0dHlwZSBEaXZlQXBpLFxuXHR0eXBlIERpdmVPcHRpb24sXG59IGZyb20gJy4uL2RpdmUtYXBpLmpzJztcbmltcG9ydCB7XG5cdEFUVFJfSU5TVEFOQ0VfSUQsXG5cdGluc3RhbmNlUmVmLFxufSBmcm9tICcuLi9saW5lYWdlLWxpbmsuanMnO1xuaW1wb3J0IHsgaXNNbmVtb25pY2FJbnN0YW5jZSB9IGZyb20gJy4uL3V0aWxzL2lzLW1uZW1vbmljYS1pbnN0YW5jZS5qcyc7XG5pbXBvcnQgdHlwZSB7XG5cdERpdmVDcmVhdGVQYXlsb2FkLFxuXHREaXZlRW50ZXJQYXlsb2FkLFxuXHREaXZlTGVhdmVQYXlsb2FkLFxuXHREaXZlUmVjb250ZXh0UGF5bG9hZCxcblx0RGl2ZVNldHRsZVBheWxvYWQsXG5cdEZsb3dFZGdlLFxufSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuXG4vLyBDYWxsL21ldGhvZC9jb25zdHJ1Y3QgZWRnZXMgY2FycnkgdGhlaXIgY2FsbHNpdGUgYXMgYG5hbWVgXG4vLyAoYC9hYnMvZmlsZS50czpsaW5lOmNvbGAsIDEtYmFzZWQpIOKAlCBzdXJmYWNlZCBhcyBPVEVMIHNlbWNvbnYgY29kZS4qXG4vLyBhdHRyaWJ1dGVzIHNvIEphZWdlciBjYW4gbGluayBzdHJhaWdodCB0byB0aGUgc291cmNlLlxuY29uc3QgQ0FMTFNJVEVfUkUgPSAvXiguKik6KFxcZCspOihcXGQrKSQvO1xuXG4vLyBUaGUgc3RyYXRlZ3kgcHVzaCBjaGFubmVsIChhbiBpbmplY3RlZCBzY3JpcHQsXG4vLyBzZWUgc3RyYXRlZ3kvY2RwLXNjcmlwdHMvd3Mtc2VydmVyLmpzKSBjYW5ub3Qgc2VlIE9URUwgc3BhbnMsIHNvIHRoZVxuLy8gYWRhcHRlciBwdWJsaXNoZXMgZWRnZUlkIOKGkiB0cmFjZUlkIG9uIGEgYm91bmRlZCBnbG9iYWwgbWFwOyB0aGUgcHVzaFxuLy8gbWFwcGVyIGZvcndhcmRzIGl0IGFuZCBtbmVtb2dyYXBoaWNhJ3MgTGl2ZSBUcmFjZSBnYWlucyB0aGUgXCJPcGVuIGluXG4vLyBKYWVnZXJcIiBqdW1wLiBnbG9iYWxUaGlzIGJlY2F1c2UgYWRhcHRlciBhbmQgaW5qZWN0ZWQgc2NyaXB0IHNoYXJlIGFcbi8vIHByb2Nlc3MsIG5vdCBhIG1vZHVsZSBncmFwaC5cbmNvbnN0IEVER0VfVFJBQ0VTX0xJTUlUID0gMTAwMDA7XG50eXBlIEVkZ2VUcmFjZU1hcCA9IE1hcDxudW1iZXIsIHN0cmluZz47XG5mdW5jdGlvbiBlZGdlVHJhY2VNYXAgKCk6IEVkZ2VUcmFjZU1hcCB7XG5cdGNvbnN0IGcgPSBnbG9iYWxUaGlzIGFzIHsgX19tbmVtb25pY2FEaXZlVHJhY2VJZHM/OiBFZGdlVHJhY2VNYXAgfTtcblx0aWYgKCFnLl9fbW5lbW9uaWNhRGl2ZVRyYWNlSWRzKSB7XG5cdFx0Zy5fX21uZW1vbmljYURpdmVUcmFjZUlkcyA9IG5ldyBNYXAoKTtcblx0fVxuXHRjb25zdCBtYXAgPSBnLl9fbW5lbW9uaWNhRGl2ZVRyYWNlSWRzO1xuXHRyZXR1cm4gbWFwO1xufVxuZnVuY3Rpb24gcmVjb3JkRWRnZVRyYWNlIChlZGdlSWQ6IG51bWJlciwgdHJhY2VJZDogc3RyaW5nKTogdm9pZCB7XG5cdGNvbnN0IG1hcCA9IGVkZ2VUcmFjZU1hcCgpO1xuXHRpZiAobWFwLmhhcyhlZGdlSWQpKSB7XG5cdFx0bWFwLmRlbGV0ZShlZGdlSWQpO1xuXHR9IGVsc2UgaWYgKG1hcC5zaXplID49IEVER0VfVFJBQ0VTX0xJTUlUKSB7XG5cdFx0Ly8gRklGTzogdGhlIG9sZGVzdCBlbnRyeSBkaWVzIGZpcnN0IOKAlCBNYXAgaXRlcmF0ZXMgaW5zZXJ0aW9uIG9yZGVyXG5cdFx0Y29uc3Qgb2xkZXN0ID0gbWFwLmtleXMoKS5uZXh0KCk7XG5cdFx0aWYgKCFvbGRlc3QuZG9uZSkge1xuXHRcdFx0bWFwLmRlbGV0ZShvbGRlc3QudmFsdWUpO1xuXHRcdH1cblx0fVxuXHRtYXAuc2V0KGVkZ2VJZCwgdHJhY2VJZCk7XG59XG5cbmV4cG9ydCBjbGFzcyBEaXZlT3RlbFByb3ZpZGVyIHtcblx0cHJpdmF0ZSB0cmFjZXI6IFRyYWNlcjtcblx0Ly8gb3BlbiBzcGFucywga2V5ZWQgb24gZGl2ZSBlZGdlIGlkIOKAlCBkcmFpbmVkIGJ5IGxlYXZlL3NldHRsZVxuXHRwcml2YXRlIHNwYW5zID0gbmV3IE1hcDxudW1iZXIsIFNwYW4+KCk7XG5cdC8vIGVkZ2UgaWQg4oaSIHBhcmVudElkLCBmb3IgdGhlIHJvb3QtZWRnZSB3YWxrIChkaXZlLnJvb3RfZWRnZV9pZCBzcGFuXG5cdC8vIGF0dHJpYnV0ZSkuIE5ldmVyIGRyYWluZWQgbWlkLWZsaWdodDogYSBjb21wbGV0ZWQgZWRnZSBjYW4gc3RpbGxcblx0Ly8gcGFyZW50IGxhdGVyIGNoaWxkcmVuIChhIGNyZWF0ZSBlZGdlIGFkb3B0cyB0aGUgbmV4dCB3cmFwcGVkIGNhbGwpLlxuXHRwcml2YXRlIGVkZ2VQYXJlbnRzID0gbmV3IE1hcDxudW1iZXIsIG51bWJlciB8IG51bGw+KCk7XG5cdC8vIFBlci1lZGdlIG1lbW9yeSBsaXZlcyBleGFjdGx5IGFzIGxvbmcgYXMgZGl2ZSByZXRhaW5zIHRoZSBlZGdlIOKAlCBub1xuXHQvLyBjb3VudC4gZGl2ZSBoYW5kcyB0aGUgaG9va3MgdGhlIHZlcnkgZWRnZSBvYmplY3RzIGl0cyBvYmplY3QgZ3JhcGhcblx0Ly8gaG9sZHM7IHdoZW4gb25lIGJlY29tZXMgdW5yZWFjaGFibGUgKHNldHRsZWQsIHVucGlubmVkLCBubyBsaXZlIGNoaWxkXG5cdC8vIOKAlCBvciBjbGVhcigpKSBhbmQgaXMgY29sbGVjdGVkLCBpdHMgZW50cnkgaXMgcmVsZWFzZWQuIFRoZSBXZWFrUmVmXG5cdC8vIGd1YXJkcyBpZCByZXVzZTogZGl2ZSdzIGNsZWFyKCkgcmVzdGFydHMgaWRzIGF0IDEsIHNvIGFuIGlkIG1heVxuXHQvLyBhbHJlYWR5IG5hbWUgYSBuZXdlciwgbGl2ZSBlZGdlIHdoZW4gYW4gb2xkIGVkZ2UncyByZWxlYXNlIGFycml2ZXMg4oCUXG5cdC8vIHRoYXQgZW50cnkgc3RheXMuXG5cdHByaXZhdGUgZWRnZVJlZnMgPSBuZXcgTWFwPG51bWJlciwgV2Vha1JlZjxGbG93RWRnZT4+KCk7XG5cdHByaXZhdGUgcmVsZWFzZWQgPSBuZXcgRmluYWxpemF0aW9uUmVnaXN0cnk8bnVtYmVyPigoZWRnZUlkKSA9PiB7XG5cdFx0Y29uc3QgcmVmID0gdGhpcy5lZGdlUmVmcy5nZXQoZWRnZUlkKTtcblx0XHRpZiAocmVmICYmIHJlZi5kZXJlZigpICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5lZGdlUmVmcy5kZWxldGUoZWRnZUlkKTtcblx0XHR0aGlzLmVkZ2VQYXJlbnRzLmRlbGV0ZShlZGdlSWQpO1xuXHR9KTtcblx0cHJpdmF0ZSBkZXRhY2hlcnM6IEFycmF5PCgpID0+IHZvaWQ+ID0gW107XG5cdC8vIHRoZSBkaXZlIHRoaXMgcHJvdmlkZXIgc3Vic2NyaWJlcyB0byDigJQgdGhlIGRlZmF1bHQgZGl2ZSB1bmxlc3MgdGhlXG5cdC8vIGNhbGxlciB0cmFjZXMgdGhyb3VnaCB0aGVpciBvd25cblx0cHJpdmF0ZSBkaXZlOiBEaXZlQXBpO1xuXG5cdGNvbnN0cnVjdG9yICh0cmFjZXI/OiBUcmFjZXIsIG9wdGlvbnM/OiBEaXZlT3B0aW9uKSB7XG5cdFx0dGhpcy50cmFjZXIgPSB0cmFjZXIgPz8gdHJhY2UuZ2V0VHJhY2VyKCdAbW5lbW9uaWNhL290ZWwnKTtcblx0XHR0aGlzLmRpdmUgPSByZXNvbHZlRGl2ZShvcHRpb25zKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBTdWJzY3JpYmUgdG8gZGl2ZSdzIGVkZ2UgbGlmZWN5Y2xlLiBJZGVtcG90ZW50OiBhdHRhY2hpbmcgdHdpY2Ugd291bGRcblx0ICogZG91YmxlIGV2ZXJ5IHNwYW4uIERpdmUncyBjbGVhcigpIHdpcGVzIHN1YnNjcmliZXJzIOKAlCByZS1hdHRhY2ggYWZ0ZXIgaXQuXG5cdCAqL1xuXHRhdHRhY2ggKCk6IHZvaWQge1xuXHRcdGlmICh0aGlzLmRldGFjaGVycy5sZW5ndGggPiAwKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHR0aGlzLmRpdmUucmVnaXN0ZXJIb29rKCdlbnRlcicsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25FbnRlcihwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygnbGVhdmUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uTGVhdmUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHRoaXMuZGl2ZS5yZWdpc3Rlckhvb2soJ3NldHRsZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25TZXR0bGUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHRoaXMuZGl2ZS5yZWdpc3Rlckhvb2soJ3JlY29udGV4dCcsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25SZWNvbnRleHQocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdC8vIGRpdmUgMC43IHN1cHBvcnQgaXMgZ29uZSAocGVlciByYW5nZSBpcyBeMC4xMC4zKTogdGhlICdjcmVhdGUnXG5cdFx0XHQvLyBldmVudCBleGlzdHMgc2luY2UgMC44LjAsIHN1YnNjcmliZSBkaXJlY3RseVxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygnY3JlYXRlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkNyZWF0ZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdCk7XG5cdH1cblxuXHRkZXRhY2ggKCk6IHZvaWQge1xuXHRcdGZvciAoY29uc3QgZGV0YWNoIG9mIHRoaXMuZGV0YWNoZXJzKSB7XG5cdFx0XHRkZXRhY2goKTtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMgPSBbXTtcblx0fVxuXG5cdHByaXZhdGUgb25FbnRlciAoeyBlZGdlIH06IERpdmVFbnRlclBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBwYXJlbnRTcGFuID0gdGhpcy5maW5kUGFyZW50U3BhbihlZGdlKTtcblx0XHRjb25zdCBjdHggPSBwYXJlbnRTcGFuXG5cdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHQ6IHVuZGVmaW5lZDtcblx0XHRjb25zdCBuYW1lID0gYGRpdmUuJHtlZGdlLmtpbmR9OiR7ZWRnZS5uYW1lfWA7XG5cdFx0Y29uc3Qgc3BhbiA9IGN0eFxuXHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSwge30sIGN0eClcblx0XHRcdDogdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUpO1xuXG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZWRnZV9pZCcsIGVkZ2UuaWQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmtpbmQnLCBlZGdlLmtpbmQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLm5hbWUnLCBlZGdlLm5hbWUpO1xuXHRcdHRoaXMuZGVjb3JhdGVTcGFuKHNwYW4sIGVkZ2UpO1xuXG5cdFx0dGhpcy5zcGFucy5zZXQoZWRnZS5pZCwgc3Bhbik7XG5cdH1cblxuXHRwcml2YXRlIG9uTGVhdmUgKHsgZWRnZSwgcmVzdWx0IH06IERpdmVMZWF2ZVBheWxvYWQpOiB2b2lkIHtcblx0XHRpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuXHRcdFx0Ly8gYXN5bmMgd29yazogdGhlIHNwYW4gY2xvc2VzIGF0IHNldHRsZSwgbm90IGF0IHRoZSBzeW5jIGhlYWQg4oCUXG5cdFx0XHQvLyBcInRoZSBmdW5jdGlvbiByZXR1cm5lZFwiIGlzIG5vdCBcInRoZSB3b3JrIGlzIGRvbmVcIlxuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmNsb3NlU3BhbihlZGdlKTtcblx0fVxuXG5cdHByaXZhdGUgb25TZXR0bGUgKHsgZWRnZSwgZXJyb3IgfTogRGl2ZVNldHRsZVBheWxvYWQpOiB2b2lkIHtcblx0XHR0aGlzLmNsb3NlU3BhbihlZGdlLCBlcnJvcik7XG5cdH1cblxuXHRwcml2YXRlIG9uUmVjb250ZXh0ICh7XG5cdFx0ZWRnZSwgcHJldmlvdXNDb250ZXh0LCBjb250ZXh0IFxuXHR9OiBEaXZlUmVjb250ZXh0UGF5bG9hZCk6IHZvaWQge1xuXHRcdC8vIE9uZS1zaG90IHNwYW46IHRoZSBvd25lcnNoaXAgdHJhbnNmZXIgaXRzZWxmLCBwYXJlbnRlZCBvbiB0aGUgT0xEXG5cdFx0Ly8gY29udGV4dCdzIHNwYW4gKHRoZSBoYW5kb2ZmIGVkZ2UncyBwYXJlbnRJZCksIHNvIHRoZSB0cmFjZSBzaG93c1xuXHRcdC8vIHdoZXJlIHRoZSBjYWxsYmFjaydzIHN0b3J5IGNyb3NzZWQgZmxvd3MuXG5cdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oZWRnZSk7XG5cdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0PyB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBwYXJlbnRTcGFuKVxuXHRcdFx0OiB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgbmFtZSA9IGBkaXZlLiR7ZWRnZS5raW5kfToke2VkZ2UubmFtZX1gO1xuXHRcdGNvbnN0IHNwYW4gPSBjdHhcblx0XHRcdD8gdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUsIHt9LCBjdHgpXG5cdFx0XHQ6IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmVkZ2VfaWQnLCBlZGdlLmlkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5raW5kJywgZWRnZS5raW5kKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5uYW1lJywgZWRnZS5uYW1lKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmJywgdHJ1ZSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuaGFuZG9mZi5oYWRfcHJldmlvdXMnLCBwcmV2aW91c0NvbnRleHQgIT09IHVuZGVmaW5lZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuaGFuZG9mZi5oYXNfY29udGV4dCcsIGNvbnRleHQgIT09IHVuZGVmaW5lZCk7XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdHByaXZhdGUgb25DcmVhdGUgKHsgZWRnZSwgZXJyb3IgfTogRGl2ZUNyZWF0ZVBheWxvYWQpOiB2b2lkIHtcblx0XHQvLyBPbmUtc2hvdCBzcGFuOiB0aGUgY29uc3RydWN0aW9uIGFscmVhZHkgY29tcGxldGVkIHdoZW4gcmVjb3JkQ3JlYXRpb25cblx0XHQvLyBmaXJlZCAodGhlIGhvb2sgbW9tZW50IElTIHRoZSBjb21wbGV0aW9uKSwgc28gdGhlIHNwYW4gc3RhcnRzIGFuZFxuXHRcdC8vIGVuZHMgaGVyZSDigJQgc2FtZSBzaGFwZSBhcyByZWNvbnRleHQuIGZpbmRQYXJlbnRTcGFuIGFkb3B0cyB0aGVcblx0XHQvLyB3cmFwcGVkIGNhbGwncyBzcGFuIHZpYSBlZGdlLnBhcmVudElkLCBvciB0aGUgYWN0aXZlIHJlcXVlc3Qgc3BhbiBhdFxuXHRcdC8vIGEgYm91bmRhcnksIHNvIGNvbnN0cnVjdGlvbnMgam9pbiB0aGUgcmVxdWVzdCB0cmFjZSBpbnN0ZWFkIG9mXG5cdFx0Ly8gb3BlbmluZyBhIHJvb3QgdHJhY2Ugb2YgdGhlaXIgb3duLlxuXHRcdGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmZpbmRQYXJlbnRTcGFuKGVkZ2UpO1xuXHRcdGNvbnN0IGN0eCA9IHBhcmVudFNwYW5cblx0XHRcdD8gdHJhY2Uuc2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSwgcGFyZW50U3Bhbilcblx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdGNvbnN0IG5hbWUgPSBgZGl2ZS4ke2VkZ2Uua2luZH06JHtlZGdlLm5hbWV9YDtcblx0XHRjb25zdCBzcGFuID0gY3R4XG5cdFx0XHQ/IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lLCB7fSwgY3R4KVxuXHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5lZGdlX2lkJywgZWRnZS5pZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUua2luZCcsIGVkZ2Uua2luZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUubmFtZScsIGVkZ2UubmFtZSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuc3RhdHVzJywgZWRnZS5zdGF0dXMpO1xuXHRcdGlmIChlZGdlLmR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmR1cmF0aW9uX21zJywgZWRnZS5kdXJhdGlvbik7XG5cdFx0fVxuXHRcdC8vIHRoZSBzYW1lIGxpbmVhZ2UgaWQgc3RhbXBDb25zdHJ1Y3Rpb25zIHB1dHMgb24gdGhlIHNwYW4gY3VycmVudCBhdFxuXHRcdC8vIGNvbnN0cnVjdGlvbiDigJQgYSBjcmVhdGUgc3BhbiBhbmQgdGhlIGluc3RhbmNlJ3MgbGluZWFnZSBqb2luIG9uIGl0XG5cdFx0Y29uc3QgeyBpbnN0YW5jZSB9ID0gZWRnZTtcblx0XHRpZiAoaW5zdGFuY2UgIT09IHVuZGVmaW5lZCAmJiBpc01uZW1vbmljYUluc3RhbmNlKGluc3RhbmNlKSkge1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoQVRUUl9JTlNUQU5DRV9JRCwgaW5zdGFuY2VSZWYoaW5zdGFuY2UpLmlkKTtcblx0XHR9XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cdFx0aWYgKGVkZ2Uuc3RhdHVzID09PSAnZXJyb3InKSB7XG5cdFx0XHRzcGFuLnNldFN0YXR1cyh7IGNvZGUgOiBTcGFuU3RhdHVzQ29kZS5FUlJPUiB9KTtcblx0XHRcdGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG5cdFx0XHRcdHNwYW4ucmVjb3JkRXhjZXB0aW9uKGVycm9yKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdHByaXZhdGUgZmluZFBhcmVudFNwYW4gKGVkZ2U6IEZsb3dFZGdlKTogU3BhbiB8IHVuZGVmaW5lZCB7XHRcdGlmIChlZGdlLnBhcmVudElkICE9PSBudWxsKSB7XG5cdFx0Y29uc3Qgb3duID0gdGhpcy5zcGFucy5nZXQoZWRnZS5wYXJlbnRJZCk7XG5cdFx0aWYgKG93bikge1xuXHRcdFx0cmV0dXJuIG93bjtcblx0XHR9XG5cdH1cblx0Ly8gQm91bmRhcnkgKG9yIGV2aWN0ZWQgcGFyZW50KTogYWRvcHQgdGhlIGFjdGl2ZSBPVGVsIHNwYW4g4oCUIHRoZSBIVFRQXG5cdC8vIHJlcXVlc3Qgc3BhbiBiZWNvbWVzIHRoZSByb290IG9mIHRoZSBkaXZlIGJyYW5jaC5cblx0Y29uc3QgYWN0aXZlID0gdHJhY2UuZ2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSk7XG5cdHJldHVybiBhY3RpdmU7XG5cdH1cblxuXHRwcml2YXRlIGNsb3NlU3BhbiAoZWRnZTogRmxvd0VkZ2UsIGVycm9yPzogdW5rbm93bik6IHZvaWQge1xuXHRcdGNvbnN0IHNwYW4gPSB0aGlzLnNwYW5zLmdldChlZGdlLmlkKTtcblx0XHRpZiAoIXNwYW4pIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5zcGFucy5kZWxldGUoZWRnZS5pZCk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5zdGF0dXMnLCBlZGdlLnN0YXR1cyk7XG5cdFx0aWYgKGVkZ2UuZHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZHVyYXRpb25fbXMnLCBlZGdlLmR1cmF0aW9uKTtcblx0XHR9XG5cdFx0aWYgKGVkZ2Uuc3RhdHVzID09PSAnZXJyb3InKSB7XG5cdFx0XHQvLyBzeW5jIHRocm93cyBjYXJyeSBubyBlcnJvciB2YWx1ZSBpbiB0aGUgbGVhdmUgcGF5bG9hZCDigJQgdGhlXG5cdFx0XHQvLyBlZGdlJ3Mgb3duIHN0YXR1cyBpcyB0aGUgdHJ1dGhmdWwgc2lnbmFsOyB0aGUgZXhjZXB0aW9uIHJlY29yZFxuXHRcdFx0Ly8gaXMgYXZhaWxhYmxlIG9ubHkgd2hlbiBzZXR0bGUgY2FycmllZCB0aGUgcmVqZWN0aW9uIGl0c2VsZlxuXHRcdFx0c3Bhbi5zZXRTdGF0dXMoeyBjb2RlIDogU3BhblN0YXR1c0NvZGUuRVJST1IgfSk7XG5cdFx0XHRpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuXHRcdFx0XHRzcGFuLnJlY29yZEV4Y2VwdGlvbihlcnJvcik7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHNwYW4uZW5kKCk7XG5cdH1cblxuXHQvLyBSZWdpc3RlciBhbiBlZGdlIGZvciByZWxlYXNlIG9uY2UsIHRoZSBmaXJzdCB0aW1lIHRoZSBwcm92aWRlciBzZWVzIGl0LlxuXHRwcml2YXRlIHRyYWNrIChlZGdlOiBGbG93RWRnZSk6IHZvaWQge1xuXHRcdGNvbnN0IGtub3duID0gdGhpcy5lZGdlUmVmcy5nZXQoZWRnZS5pZCk7XG5cdFx0aWYgKGtub3duICYmIGtub3duLmRlcmVmKCkgPT09IGVkZ2UpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5lZGdlUmVmcy5zZXQoZWRnZS5pZCwgbmV3IFdlYWtSZWYoZWRnZSkpO1xuXHRcdHRoaXMucmVsZWFzZWQucmVnaXN0ZXIoZWRnZSwgZWRnZS5pZCk7XG5cdH1cblxuXHQvKipcblx0ICogQ3Jvc3Mtc3VyZmFjZSBhdHRyaWJ1dGVzIGV2ZXJ5IHNwYW4gZ2V0cywgb24gZXZlcnkgaG9vayBwYXRoOlxuXHQgKiB0aGUgZWRnZSdzIHRyYWNlIHJvb3QgaWQgKEphZWdlciBsaW5rIOKGkiBtbmVtb2dyYXBoaWNhJ3MgTGl2ZSBUcmFjZSksXG5cdCAqIHRoZSBlZGdlSWTihpJ0cmFjZUlkIHB1YmxpY2F0aW9uIGZvciB0aGUgc3RyYXRlZ3kgcHVzaCBjaGFubmVsLCBhbmRcblx0ICogY29kZS5maWxlcGF0aC9saW5lL2NvbHVtbiBwYXJzZWQgZnJvbSB0aGUgY2FsbHNpdGUgbmFtZS5cblx0ICovXG5cdHByaXZhdGUgZGVjb3JhdGVTcGFuIChzcGFuOiBTcGFuLCBlZGdlOiBGbG93RWRnZSk6IHZvaWQge1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLnJvb3RfZWRnZV9pZCcsIHRoaXMucm9vdEVkZ2VJZE9mKGVkZ2UpKTtcblx0XHRyZWNvcmRFZGdlVHJhY2UoZWRnZS5pZCwgc3Bhbi5zcGFuQ29udGV4dCgpLnRyYWNlSWQpO1xuXHRcdGlmIChlZGdlLmtpbmQgIT09ICdjYWxsJyAmJiBlZGdlLmtpbmQgIT09ICdtZXRob2QnICYmIGVkZ2Uua2luZCAhPT0gJ2NvbnN0cnVjdCcpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgbWF0Y2ggPSBDQUxMU0lURV9SRS5leGVjKGVkZ2UubmFtZSk7XG5cdFx0aWYgKCFtYXRjaCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnY29kZS5maWxlcGF0aCcsIG1hdGNoWyAxIF0pO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdjb2RlLmxpbmVubycsIE51bWJlcihtYXRjaFsgMiBdKSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUuY29sdW1uJywgTnVtYmVyKG1hdGNoWyAzIF0pKTtcblx0fVxuXG5cdC8vIFdhbGsgZGl2ZSdzIHBhcmVudGFnZSB0byB0aGUgcm9vdCBlZGdlIGlkLiBQYXJlbnRzIGFyZSByZWNvcmRlZCBhc1xuXHQvLyBlZGdlcyBhcnJpdmUgKGVudGVyIGZpcmVzIHBhcmVudC1iZWZvcmUtY2hpbGQpLCBzbyB0aGUgY2hhaW4gaXNcblx0Ly8gY29tcGxldGUgZm9yIGFueXRoaW5nIHN0aWxsIGluIGZsaWdodDsgYW4gZXZpY3RlZC91bmtub3duIHBhcmVudFxuXHQvLyBzaW1wbHkgZW5kcyB0aGUgd2FsayBhdCB0aGUgZGVlcGVzdCBrbm93biBpZC5cblx0cHJpdmF0ZSByb290RWRnZUlkT2YgKGVkZ2U6IEZsb3dFZGdlKTogbnVtYmVyIHtcblx0XHR0aGlzLnRyYWNrKGVkZ2UpO1xuXHRcdHRoaXMuZWRnZVBhcmVudHMuc2V0KGVkZ2UuaWQsIGVkZ2UucGFyZW50SWQpO1xuXHRcdGxldCB7IGlkIH0gPSBlZGdlO1xuXHRcdGxldCBwYXJlbnQgPSBlZGdlLnBhcmVudElkO1xuXHRcdGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oWyBpZCBdKTtcblx0XHR3aGlsZSAocGFyZW50ICE9PSBudWxsICYmICFzZWVuLmhhcyhwYXJlbnQpKSB7XG5cdFx0XHRzZWVuLmFkZChwYXJlbnQpO1xuXHRcdFx0aWQgPSBwYXJlbnQ7XG5cdFx0XHRjb25zdCBuZXh0ID0gdGhpcy5lZGdlUGFyZW50cy5nZXQocGFyZW50KTtcblx0XHRcdHBhcmVudCA9IG5leHQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBuZXh0O1xuXHRcdH1cblx0XHRyZXR1cm4gaWQ7XG5cdH1cbn1cbiJdfQ==