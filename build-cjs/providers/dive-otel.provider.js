"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiveOtelProvider = void 0;
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
const api_1 = require("@opentelemetry/api");
const dive_api_js_1 = require("../dive-api.js");
const lineage_link_js_1 = require("../lineage-link.js");
const is_mnemonica_instance_js_1 = require("../utils/is-mnemonica-instance.js");
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
    // the dive this provider subscribes to — the default dive unless the
    // caller traces through their own
    dive;
    constructor(tracer, options) {
        this.tracer = tracer ?? api_1.trace.getTracer('@mnemonica/otel');
        this.dive = (0, dive_api_js_1.resolveDive)(options);
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
        // the same lineage id stampConstructions puts on the span current at
        // construction — a create span and the instance's lineage join on it
        const { instance } = edge;
        if (instance !== undefined && (0, is_mnemonica_instance_js_1.isMnemonicaInstance)(instance)) {
            span.setAttribute(lineage_link_js_1.ATTR_INSTANCE_ID, (0, lineage_link_js_1.instanceRef)(instance).id);
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
exports.DiveOtelProvider = DiveOtelProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGl2ZS1vdGVsLnByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILDRDQU00QjtBQUM1QixnREFJd0I7QUFDeEIsd0RBRzRCO0FBQzVCLGdGQUF3RTtBQVV4RSw2REFBNkQ7QUFDN0QsdUVBQXVFO0FBQ3ZFLHdEQUF3RDtBQUN4RCxNQUFNLFdBQVcsR0FBRyxvQkFBb0IsQ0FBQztBQUV6QyxpREFBaUQ7QUFDakQsdUVBQXVFO0FBQ3ZFLHVFQUF1RTtBQUN2RSx1RUFBdUU7QUFDdkUsdUVBQXVFO0FBQ3ZFLCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQztBQUVoQyxTQUFTLFlBQVk7SUFDcEIsTUFBTSxDQUFDLEdBQUcsVUFBd0QsQ0FBQztJQUNuRSxJQUFJLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDaEMsQ0FBQyxDQUFDLHVCQUF1QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7SUFDdkMsQ0FBQztJQUNELE1BQU0sR0FBRyxHQUFHLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQztJQUN0QyxPQUFPLEdBQUcsQ0FBQztBQUNaLENBQUM7QUFDRCxTQUFTLGVBQWUsQ0FBRSxNQUFjLEVBQUUsT0FBZTtJQUN4RCxNQUFNLEdBQUcsR0FBRyxZQUFZLEVBQUUsQ0FBQztJQUMzQixJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUNyQixHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3BCLENBQUM7U0FBTSxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUksaUJBQWlCLEVBQUUsQ0FBQztRQUMxQyxtRUFBbUU7UUFDbkUsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLElBQUksRUFB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Q0FBQztJQUNYLENBQUM7Q0FDRDtBQXpQRCw0Q0F5UEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9wZW5UZWxlbWV0cnkgcHJvdmlkZXIgZm9yIGRpdmUncyBlZGdlIGxpZmVjeWNsZSBob29rcy5cbiAqXG4gKiBXaGVyZSBNbmVtb25pY2FPdGVsUHJvdmlkZXIgc3BhbnMgQ09OU1RSVUNUSU9OUyAobW5lbW9uaWNhIGhvb2tzKSwgdGhpc1xuICogcHJvdmlkZXIgc3BhbnMgRVZFUlkgV1JBUFBFRCBDQUxMIChkaXZlIGhvb2tzKTogY2FsbCAvIGNvbnN0cnVjdCAvIG1ldGhvZCAvXG4gKiByZWNvbnRleHQgZWRnZXMgZWFjaCBiZWNvbWUgYSBzcGFuLCBwYXJlbnRlZCBvbiB0aGUgc3BhbiBvZiB0aGUgZWRnZSdzXG4gKiBwYXJlbnRJZCDigJQgZGl2ZSdzIG93biB0cmFjZSBwYXJlbnRhZ2UsIG5vdCBBTFMuIEF0IHVud3JhcHBlZCBib3VuZGFyaWVzXG4gKiAocGFyZW50SWQgbnVsbCkgdGhlIHNwYW4gYWRvcHRzIHRoZSBjdXJyZW50bHkgQUNUSVZFIE9UZWwgc3BhbiBhcyBwYXJlbnQsXG4gKiBzbyBhblxuICogSFRUUCByZXF1ZXN0IHNwYW4gYWRvcHRzIHRoZSB3aG9sZSBkaXZlIGJyYW5jaC4gJ2NyZWF0ZScgZWRnZXMgKG1uZW1vbmljYVxuICogY29uc3RydWN0aW9ucyByZWNvcmRlZCB2aWEgcmVjb3JkQ3JlYXRpb24vcmVjb3JkQ3JlYXRpb25FcnJvcikgYmVjb21lXG4gKiBvbmUtc2hvdCBzcGFucyBvbiB0aGUgc2FtZSBwYXJlbnRhZ2Ug4oCUIHRoZSBjb25zdHJ1Y3Rpb24gSEFTIGNvbXBsZXRlZCB3aGVuXG4gKiB0aGUgaG9vayBmaXJlcywgc28gdGhlIHNwYW4gc3RhcnRzIGFuZCBlbmRzIGluc2lkZSB0aGUgaGFuZGxlci5cbiAqXG4gKiBBc3luYyB0cnV0aGZ1bG5lc3M6IGEgc3BhbiBkb2VzIE5PVCBlbmQgYXQgdGhlIHN5bmMgY2xvc2Ugd2hlbiB0aGUgd3JhcFxuICogcHJvZHVjZWQgYSB0YXBwZWQgcHJvbWlzZSDigJQgaXQgZW5kcyBhdCBzZXR0bGUsIHdpdGggdGhlIGNoYWluJ3Mgb3V0Y29tZS5cbiAqIFNwYW5zIGFyZSBrZXllZCBvbiBlZGdlIGlkOyBldmVyeSByZWNvcmRlZCBlZGdlIGZpcmVzIGxlYXZlIChhbmQsIHdoZW5cbiAqIGFzeW5jLCBzZXR0bGUpLCBzbyB0aGUgbWFwIGFsd2F5cyBkcmFpbnMuXG4gKi9cbmltcG9ydCB7XG5cdFNwYW5TdGF0dXNDb2RlLFxuXHRjb250ZXh0IGFzIG90ZWxDb250ZXh0LFxuXHR0cmFjZSxcblx0dHlwZSBTcGFuLFxuXHR0eXBlIFRyYWNlcixcbn0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB7XG5cdHJlc29sdmVEaXZlLFxuXHR0eXBlIERpdmVBcGksXG5cdHR5cGUgRGl2ZU9wdGlvbixcbn0gZnJvbSAnLi4vZGl2ZS1hcGkuanMnO1xuaW1wb3J0IHtcblx0QVRUUl9JTlNUQU5DRV9JRCxcblx0aW5zdGFuY2VSZWYsXG59IGZyb20gJy4uL2xpbmVhZ2UtbGluay5qcyc7XG5pbXBvcnQgeyBpc01uZW1vbmljYUluc3RhbmNlIH0gZnJvbSAnLi4vdXRpbHMvaXMtbW5lbW9uaWNhLWluc3RhbmNlLmpzJztcbmltcG9ydCB0eXBlIHtcblx0RGl2ZUNyZWF0ZVBheWxvYWQsXG5cdERpdmVFbnRlclBheWxvYWQsXG5cdERpdmVMZWF2ZVBheWxvYWQsXG5cdERpdmVSZWNvbnRleHRQYXlsb2FkLFxuXHREaXZlU2V0dGxlUGF5bG9hZCxcblx0Rmxvd0VkZ2UsXG59IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5cbi8vIENhbGwvbWV0aG9kL2NvbnN0cnVjdCBlZGdlcyBjYXJyeSB0aGVpciBjYWxsc2l0ZSBhcyBgbmFtZWBcbi8vIChgL2Ficy9maWxlLnRzOmxpbmU6Y29sYCwgMS1iYXNlZCkg4oCUIHN1cmZhY2VkIGFzIE9URUwgc2VtY29udiBjb2RlLipcbi8vIGF0dHJpYnV0ZXMgc28gSmFlZ2VyIGNhbiBsaW5rIHN0cmFpZ2h0IHRvIHRoZSBzb3VyY2UuXG5jb25zdCBDQUxMU0lURV9SRSA9IC9eKC4qKTooXFxkKyk6KFxcZCspJC87XG5cbi8vIFRoZSBzdHJhdGVneSBwdXNoIGNoYW5uZWwgKGFuIGluamVjdGVkIHNjcmlwdCxcbi8vIHNlZSBzdHJhdGVneS9jZHAtc2NyaXB0cy93cy1zZXJ2ZXIuanMpIGNhbm5vdCBzZWUgT1RFTCBzcGFucywgc28gdGhlXG4vLyBhZGFwdGVyIHB1Ymxpc2hlcyBlZGdlSWQg4oaSIHRyYWNlSWQgb24gYSBib3VuZGVkIGdsb2JhbCBtYXA7IHRoZSBwdXNoXG4vLyBtYXBwZXIgZm9yd2FyZHMgaXQgYW5kIG1uZW1vZ3JhcGhpY2EncyBMaXZlIFRyYWNlIGdhaW5zIHRoZSBcIk9wZW4gaW5cbi8vIEphZWdlclwiIGp1bXAuIGdsb2JhbFRoaXMgYmVjYXVzZSBhZGFwdGVyIGFuZCBpbmplY3RlZCBzY3JpcHQgc2hhcmUgYVxuLy8gcHJvY2Vzcywgbm90IGEgbW9kdWxlIGdyYXBoLlxuY29uc3QgRURHRV9UUkFDRVNfTElNSVQgPSAxMDAwMDtcbnR5cGUgRWRnZVRyYWNlTWFwID0gTWFwPG51bWJlciwgc3RyaW5nPjtcbmZ1bmN0aW9uIGVkZ2VUcmFjZU1hcCAoKTogRWRnZVRyYWNlTWFwIHtcblx0Y29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgeyBfX21uZW1vbmljYURpdmVUcmFjZUlkcz86IEVkZ2VUcmFjZU1hcCB9O1xuXHRpZiAoIWcuX19tbmVtb25pY2FEaXZlVHJhY2VJZHMpIHtcblx0XHRnLl9fbW5lbW9uaWNhRGl2ZVRyYWNlSWRzID0gbmV3IE1hcCgpO1xuXHR9XG5cdGNvbnN0IG1hcCA9IGcuX19tbmVtb25pY2FEaXZlVHJhY2VJZHM7XG5cdHJldHVybiBtYXA7XG59XG5mdW5jdGlvbiByZWNvcmRFZGdlVHJhY2UgKGVkZ2VJZDogbnVtYmVyLCB0cmFjZUlkOiBzdHJpbmcpOiB2b2lkIHtcblx0Y29uc3QgbWFwID0gZWRnZVRyYWNlTWFwKCk7XG5cdGlmIChtYXAuaGFzKGVkZ2VJZCkpIHtcblx0XHRtYXAuZGVsZXRlKGVkZ2VJZCk7XG5cdH0gZWxzZSBpZiAobWFwLnNpemUgPj0gRURHRV9UUkFDRVNfTElNSVQpIHtcblx0XHQvLyBGSUZPOiB0aGUgb2xkZXN0IGVudHJ5IGRpZXMgZmlyc3Qg4oCUIE1hcCBpdGVyYXRlcyBpbnNlcnRpb24gb3JkZXJcblx0XHRjb25zdCBvbGRlc3QgPSBtYXAua2V5cygpLm5leHQoKTtcblx0XHRpZiAoIW9sZGVzdC5kb25lKSB7XG5cdFx0XHRtYXAuZGVsZXRlKG9sZGVzdC52YWx1ZSk7XG5cdFx0fVxuXHR9XG5cdG1hcC5zZXQoZWRnZUlkLCB0cmFjZUlkKTtcbn1cblxuZXhwb3J0IGNsYXNzIERpdmVPdGVsUHJvdmlkZXIge1xuXHRwcml2YXRlIHRyYWNlcjogVHJhY2VyO1xuXHQvLyBvcGVuIHNwYW5zLCBrZXllZCBvbiBkaXZlIGVkZ2UgaWQg4oCUIGRyYWluZWQgYnkgbGVhdmUvc2V0dGxlXG5cdHByaXZhdGUgc3BhbnMgPSBuZXcgTWFwPG51bWJlciwgU3Bhbj4oKTtcblx0Ly8gZWRnZSBpZCDihpIgcGFyZW50SWQsIGZvciB0aGUgcm9vdC1lZGdlIHdhbGsgKGRpdmUucm9vdF9lZGdlX2lkIHNwYW5cblx0Ly8gYXR0cmlidXRlKS4gTmV2ZXIgZHJhaW5lZCBtaWQtZmxpZ2h0OiBhIGNvbXBsZXRlZCBlZGdlIGNhbiBzdGlsbFxuXHQvLyBwYXJlbnQgbGF0ZXIgY2hpbGRyZW4gKGEgY3JlYXRlIGVkZ2UgYWRvcHRzIHRoZSBuZXh0IHdyYXBwZWQgY2FsbCkuXG5cdHByaXZhdGUgZWRnZVBhcmVudHMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyIHwgbnVsbD4oKTtcblx0Ly8gUGVyLWVkZ2UgbWVtb3J5IGxpdmVzIGV4YWN0bHkgYXMgbG9uZyBhcyBkaXZlIHJldGFpbnMgdGhlIGVkZ2Ug4oCUIG5vXG5cdC8vIGNvdW50LiBkaXZlIGhhbmRzIHRoZSBob29rcyB0aGUgdmVyeSBlZGdlIG9iamVjdHMgaXRzIG9iamVjdCBncmFwaFxuXHQvLyBob2xkczsgd2hlbiBvbmUgYmVjb21lcyB1bnJlYWNoYWJsZSAoc2V0dGxlZCwgdW5waW5uZWQsIG5vIGxpdmUgY2hpbGRcblx0Ly8g4oCUIG9yIGNsZWFyKCkpIGFuZCBpcyBjb2xsZWN0ZWQsIGl0cyBlbnRyeSBpcyByZWxlYXNlZC4gVGhlIFdlYWtSZWZcblx0Ly8gZ3VhcmRzIGlkIHJldXNlOiBkaXZlJ3MgY2xlYXIoKSByZXN0YXJ0cyBpZHMgYXQgMSwgc28gYW4gaWQgbWF5XG5cdC8vIGFscmVhZHkgbmFtZSBhIG5ld2VyLCBsaXZlIGVkZ2Ugd2hlbiBhbiBvbGQgZWRnZSdzIHJlbGVhc2UgYXJyaXZlcyDigJRcblx0Ly8gdGhhdCBlbnRyeSBzdGF5cy5cblx0cHJpdmF0ZSBlZGdlUmVmcyA9IG5ldyBNYXA8bnVtYmVyLCBXZWFrUmVmPEZsb3dFZGdlPj4oKTtcblx0cHJpdmF0ZSByZWxlYXNlZCA9IG5ldyBGaW5hbGl6YXRpb25SZWdpc3RyeTxudW1iZXI+KChlZGdlSWQpID0+IHtcblx0XHRjb25zdCByZWYgPSB0aGlzLmVkZ2VSZWZzLmdldChlZGdlSWQpO1xuXHRcdGlmIChyZWYgJiYgcmVmLmRlcmVmKCkgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmVkZ2VSZWZzLmRlbGV0ZShlZGdlSWQpO1xuXHRcdHRoaXMuZWRnZVBhcmVudHMuZGVsZXRlKGVkZ2VJZCk7XG5cdH0pO1xuXHRwcml2YXRlIGRldGFjaGVyczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblx0Ly8gdGhlIGRpdmUgdGhpcyBwcm92aWRlciBzdWJzY3JpYmVzIHRvIOKAlCB0aGUgZGVmYXVsdCBkaXZlIHVubGVzcyB0aGVcblx0Ly8gY2FsbGVyIHRyYWNlcyB0aHJvdWdoIHRoZWlyIG93blxuXHRwcml2YXRlIGRpdmU6IERpdmVBcGk7XG5cblx0Y29uc3RydWN0b3IgKHRyYWNlcj86IFRyYWNlciwgb3B0aW9ucz86IERpdmVPcHRpb24pIHtcblx0XHR0aGlzLnRyYWNlciA9IHRyYWNlciA/PyB0cmFjZS5nZXRUcmFjZXIoJ0BtbmVtb25pY2Evb3RlbCcpO1xuXHRcdHRoaXMuZGl2ZSA9IHJlc29sdmVEaXZlKG9wdGlvbnMpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFN1YnNjcmliZSB0byBkaXZlJ3MgZWRnZSBsaWZlY3ljbGUuIElkZW1wb3RlbnQ6IGF0dGFjaGluZyB0d2ljZSB3b3VsZFxuXHQgKiBkb3VibGUgZXZlcnkgc3Bhbi4gRGl2ZSdzIGNsZWFyKCkgd2lwZXMgc3Vic2NyaWJlcnMg4oCUIHJlLWF0dGFjaCBhZnRlciBpdC5cblx0ICovXG5cdGF0dGFjaCAoKTogdm9pZCB7XG5cdFx0aWYgKHRoaXMuZGV0YWNoZXJzLmxlbmd0aCA+IDApIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMucHVzaChcblx0XHRcdHRoaXMuZGl2ZS5yZWdpc3Rlckhvb2soJ2VudGVyJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkVudGVyKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0XHR0aGlzLmRpdmUucmVnaXN0ZXJIb29rKCdsZWF2ZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25MZWF2ZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygnc2V0dGxlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vblNldHRsZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygncmVjb250ZXh0JywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vblJlY29udGV4dChwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0Ly8gZGl2ZSAwLjcgc3VwcG9ydCBpcyBnb25lIChwZWVyIHJhbmdlIGlzIF4wLjEwLjMpOiB0aGUgJ2NyZWF0ZSdcblx0XHRcdC8vIGV2ZW50IGV4aXN0cyBzaW5jZSAwLjguMCwgc3Vic2NyaWJlIGRpcmVjdGx5XG5cdFx0XHR0aGlzLmRpdmUucmVnaXN0ZXJIb29rKCdjcmVhdGUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uQ3JlYXRlKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0KTtcblx0fVxuXG5cdGRldGFjaCAoKTogdm9pZCB7XG5cdFx0Zm9yIChjb25zdCBkZXRhY2ggb2YgdGhpcy5kZXRhY2hlcnMpIHtcblx0XHRcdGRldGFjaCgpO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycyA9IFtdO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkVudGVyICh7IGVkZ2UgfTogRGl2ZUVudGVyUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmZpbmRQYXJlbnRTcGFuKGVkZ2UpO1xuXHRcdGNvbnN0IGN0eCA9IHBhcmVudFNwYW5cblx0XHRcdD8gdHJhY2Uuc2V0U3BhbihvdGVsQ29udGV4dC5hY3RpdmUoKSwgcGFyZW50U3Bhbilcblx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdGNvbnN0IG5hbWUgPSBgZGl2ZS4ke2VkZ2Uua2luZH06JHtlZGdlLm5hbWV9YDtcblx0XHRjb25zdCBzcGFuID0gY3R4XG5cdFx0XHQ/IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lLCB7fSwgY3R4KVxuXHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSk7XG5cblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5lZGdlX2lkJywgZWRnZS5pZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUua2luZCcsIGVkZ2Uua2luZCk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUubmFtZScsIGVkZ2UubmFtZSk7XG5cdFx0dGhpcy5kZWNvcmF0ZVNwYW4oc3BhbiwgZWRnZSk7XG5cblx0XHR0aGlzLnNwYW5zLnNldChlZGdlLmlkLCBzcGFuKTtcblx0fVxuXG5cdHByaXZhdGUgb25MZWF2ZSAoeyBlZGdlLCByZXN1bHQgfTogRGl2ZUxlYXZlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG5cdFx0XHQvLyBhc3luYyB3b3JrOiB0aGUgc3BhbiBjbG9zZXMgYXQgc2V0dGxlLCBub3QgYXQgdGhlIHN5bmMgaGVhZCDigJRcblx0XHRcdC8vIFwidGhlIGZ1bmN0aW9uIHJldHVybmVkXCIgaXMgbm90IFwidGhlIHdvcmsgaXMgZG9uZVwiXG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuY2xvc2VTcGFuKGVkZ2UpO1xuXHR9XG5cblx0cHJpdmF0ZSBvblNldHRsZSAoeyBlZGdlLCBlcnJvciB9OiBEaXZlU2V0dGxlUGF5bG9hZCk6IHZvaWQge1xuXHRcdHRoaXMuY2xvc2VTcGFuKGVkZ2UsIGVycm9yKTtcblx0fVxuXG5cdHByaXZhdGUgb25SZWNvbnRleHQgKHtcblx0XHRlZGdlLCBwcmV2aW91c0NvbnRleHQsIGNvbnRleHQgXG5cdH06IERpdmVSZWNvbnRleHRQYXlsb2FkKTogdm9pZCB7XG5cdFx0Ly8gT25lLXNob3Qgc3BhbjogdGhlIG93bmVyc2hpcCB0cmFuc2ZlciBpdHNlbGYsIHBhcmVudGVkIG9uIHRoZSBPTERcblx0XHQvLyBjb250ZXh0J3Mgc3BhbiAodGhlIGhhbmRvZmYgZWRnZSdzIHBhcmVudElkKSwgc28gdGhlIHRyYWNlIHNob3dzXG5cdFx0Ly8gd2hlcmUgdGhlIGNhbGxiYWNrJ3Mgc3RvcnkgY3Jvc3NlZCBmbG93cy5cblx0XHRjb25zdCBwYXJlbnRTcGFuID0gdGhpcy5maW5kUGFyZW50U3BhbihlZGdlKTtcblx0XHRjb25zdCBjdHggPSBwYXJlbnRTcGFuXG5cdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHQ6IHVuZGVmaW5lZDtcblx0XHRjb25zdCBuYW1lID0gYGRpdmUuJHtlZGdlLmtpbmR9OiR7ZWRnZS5uYW1lfWA7XG5cdFx0Y29uc3Qgc3BhbiA9IGN0eFxuXHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4obmFtZSwge30sIGN0eClcblx0XHRcdDogdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUpO1xuXG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZWRnZV9pZCcsIGVkZ2UuaWQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmtpbmQnLCBlZGdlLmtpbmQpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLm5hbWUnLCBlZGdlLm5hbWUpO1xuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmhhbmRvZmYnLCB0cnVlKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmLmhhZF9wcmV2aW91cycsIHByZXZpb3VzQ29udGV4dCAhPT0gdW5kZWZpbmVkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5oYW5kb2ZmLmhhc19jb250ZXh0JywgY29udGV4dCAhPT0gdW5kZWZpbmVkKTtcblx0XHR0aGlzLmRlY29yYXRlU3BhbihzcGFuLCBlZGdlKTtcblx0XHRzcGFuLmVuZCgpO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkNyZWF0ZSAoeyBlZGdlLCBlcnJvciB9OiBEaXZlQ3JlYXRlUGF5bG9hZCk6IHZvaWQge1xuXHRcdC8vIE9uZS1zaG90IHNwYW46IHRoZSBjb25zdHJ1Y3Rpb24gYWxyZWFkeSBjb21wbGV0ZWQgd2hlbiByZWNvcmRDcmVhdGlvblxuXHRcdC8vIGZpcmVkICh0aGUgaG9vayBtb21lbnQgSVMgdGhlIGNvbXBsZXRpb24pLCBzbyB0aGUgc3BhbiBzdGFydHMgYW5kXG5cdFx0Ly8gZW5kcyBoZXJlIOKAlCBzYW1lIHNoYXBlIGFzIHJlY29udGV4dC4gZmluZFBhcmVudFNwYW4gYWRvcHRzIHRoZVxuXHRcdC8vIHdyYXBwZWQgY2FsbCdzIHNwYW4gdmlhIGVkZ2UucGFyZW50SWQsIG9yIHRoZSBhY3RpdmUgcmVxdWVzdCBzcGFuIGF0XG5cdFx0Ly8gYSBib3VuZGFyeSwgc28gY29uc3RydWN0aW9ucyBqb2luIHRoZSByZXF1ZXN0IHRyYWNlIGluc3RlYWQgb2Zcblx0XHQvLyBvcGVuaW5nIGEgcm9vdCB0cmFjZSBvZiB0aGVpciBvd24uXG5cdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oZWRnZSk7XG5cdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0PyB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBwYXJlbnRTcGFuKVxuXHRcdFx0OiB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgbmFtZSA9IGBkaXZlLiR7ZWRnZS5raW5kfToke2VkZ2UubmFtZX1gO1xuXHRcdGNvbnN0IHNwYW4gPSBjdHhcblx0XHRcdD8gdGhpcy50cmFjZXIuc3RhcnRTcGFuKG5hbWUsIHt9LCBjdHgpXG5cdFx0XHQ6IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihuYW1lKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLmVkZ2VfaWQnLCBlZGdlLmlkKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5raW5kJywgZWRnZS5raW5kKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5uYW1lJywgZWRnZS5uYW1lKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5zdGF0dXMnLCBlZGdlLnN0YXR1cyk7XG5cdFx0aWYgKGVkZ2UuZHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUuZHVyYXRpb25fbXMnLCBlZGdlLmR1cmF0aW9uKTtcblx0XHR9XG5cdFx0Ly8gdGhlIHNhbWUgbGluZWFnZSBpZCBzdGFtcENvbnN0cnVjdGlvbnMgcHV0cyBvbiB0aGUgc3BhbiBjdXJyZW50IGF0XG5cdFx0Ly8gY29uc3RydWN0aW9uIOKAlCBhIGNyZWF0ZSBzcGFuIGFuZCB0aGUgaW5zdGFuY2UncyBsaW5lYWdlIGpvaW4gb24gaXRcblx0XHRjb25zdCB7IGluc3RhbmNlIH0gPSBlZGdlO1xuXHRcdGlmIChpbnN0YW5jZSAhPT0gdW5kZWZpbmVkICYmIGlzTW5lbW9uaWNhSW5zdGFuY2UoaW5zdGFuY2UpKSB7XG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZShBVFRSX0lOU1RBTkNFX0lELCBpbnN0YW5jZVJlZihpbnN0YW5jZSkuaWQpO1xuXHRcdH1cblx0XHR0aGlzLmRlY29yYXRlU3BhbihzcGFuLCBlZGdlKTtcblx0XHRpZiAoZWRnZS5zdGF0dXMgPT09ICdlcnJvcicpIHtcblx0XHRcdHNwYW4uc2V0U3RhdHVzKHsgY29kZSA6IFNwYW5TdGF0dXNDb2RlLkVSUk9SIH0pO1xuXHRcdFx0aWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRcdFx0c3Bhbi5yZWNvcmRFeGNlcHRpb24oZXJyb3IpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRzcGFuLmVuZCgpO1xuXHR9XG5cblx0cHJpdmF0ZSBmaW5kUGFyZW50U3BhbiAoZWRnZTogRmxvd0VkZ2UpOiBTcGFuIHwgdW5kZWZpbmVkIHtcdFx0aWYgKGVkZ2UucGFyZW50SWQgIT09IG51bGwpIHtcblx0XHRjb25zdCBvd24gPSB0aGlzLnNwYW5zLmdldChlZGdlLnBhcmVudElkKTtcblx0XHRpZiAob3duKSB7XG5cdFx0XHRyZXR1cm4gb3duO1xuXHRcdH1cblx0fVxuXHQvLyBCb3VuZGFyeSAob3IgZXZpY3RlZCBwYXJlbnQpOiBhZG9wdCB0aGUgYWN0aXZlIE9UZWwgc3BhbiDigJQgdGhlIEhUVFBcblx0Ly8gcmVxdWVzdCBzcGFuIGJlY29tZXMgdGhlIHJvb3Qgb2YgdGhlIGRpdmUgYnJhbmNoLlxuXHRjb25zdCBhY3RpdmUgPSB0cmFjZS5nZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpKTtcblx0cmV0dXJuIGFjdGl2ZTtcblx0fVxuXG5cdHByaXZhdGUgY2xvc2VTcGFuIChlZGdlOiBGbG93RWRnZSwgZXJyb3I/OiB1bmtub3duKTogdm9pZCB7XG5cdFx0Y29uc3Qgc3BhbiA9IHRoaXMuc3BhbnMuZ2V0KGVkZ2UuaWQpO1xuXHRcdGlmICghc3Bhbikge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLnNwYW5zLmRlbGV0ZShlZGdlLmlkKTtcblxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdkaXZlLnN0YXR1cycsIGVkZ2Uuc3RhdHVzKTtcblx0XHRpZiAoZWRnZS5kdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnZGl2ZS5kdXJhdGlvbl9tcycsIGVkZ2UuZHVyYXRpb24pO1xuXHRcdH1cblx0XHRpZiAoZWRnZS5zdGF0dXMgPT09ICdlcnJvcicpIHtcblx0XHRcdC8vIHN5bmMgdGhyb3dzIGNhcnJ5IG5vIGVycm9yIHZhbHVlIGluIHRoZSBsZWF2ZSBwYXlsb2FkIOKAlCB0aGVcblx0XHRcdC8vIGVkZ2UncyBvd24gc3RhdHVzIGlzIHRoZSB0cnV0aGZ1bCBzaWduYWw7IHRoZSBleGNlcHRpb24gcmVjb3JkXG5cdFx0XHQvLyBpcyBhdmFpbGFibGUgb25seSB3aGVuIHNldHRsZSBjYXJyaWVkIHRoZSByZWplY3Rpb24gaXRzZWxmXG5cdFx0XHRzcGFuLnNldFN0YXR1cyh7IGNvZGUgOiBTcGFuU3RhdHVzQ29kZS5FUlJPUiB9KTtcblx0XHRcdGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG5cdFx0XHRcdHNwYW4ucmVjb3JkRXhjZXB0aW9uKGVycm9yKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0c3Bhbi5lbmQoKTtcblx0fVxuXG5cdC8vIFJlZ2lzdGVyIGFuIGVkZ2UgZm9yIHJlbGVhc2Ugb25jZSwgdGhlIGZpcnN0IHRpbWUgdGhlIHByb3ZpZGVyIHNlZXMgaXQuXG5cdHByaXZhdGUgdHJhY2sgKGVkZ2U6IEZsb3dFZGdlKTogdm9pZCB7XG5cdFx0Y29uc3Qga25vd24gPSB0aGlzLmVkZ2VSZWZzLmdldChlZGdlLmlkKTtcblx0XHRpZiAoa25vd24gJiYga25vd24uZGVyZWYoKSA9PT0gZWRnZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmVkZ2VSZWZzLnNldChlZGdlLmlkLCBuZXcgV2Vha1JlZihlZGdlKSk7XG5cdFx0dGhpcy5yZWxlYXNlZC5yZWdpc3RlcihlZGdlLCBlZGdlLmlkKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBDcm9zcy1zdXJmYWNlIGF0dHJpYnV0ZXMgZXZlcnkgc3BhbiBnZXRzLCBvbiBldmVyeSBob29rIHBhdGg6XG5cdCAqIHRoZSBlZGdlJ3MgdHJhY2Ugcm9vdCBpZCAoSmFlZ2VyIGxpbmsg4oaSIG1uZW1vZ3JhcGhpY2EncyBMaXZlIFRyYWNlKSxcblx0ICogdGhlIGVkZ2VJZOKGknRyYWNlSWQgcHVibGljYXRpb24gZm9yIHRoZSBzdHJhdGVneSBwdXNoIGNoYW5uZWwsIGFuZFxuXHQgKiBjb2RlLmZpbGVwYXRoL2xpbmUvY29sdW1uIHBhcnNlZCBmcm9tIHRoZSBjYWxsc2l0ZSBuYW1lLlxuXHQgKi9cblx0cHJpdmF0ZSBkZWNvcmF0ZVNwYW4gKHNwYW46IFNwYW4sIGVkZ2U6IEZsb3dFZGdlKTogdm9pZCB7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2RpdmUucm9vdF9lZGdlX2lkJywgdGhpcy5yb290RWRnZUlkT2YoZWRnZSkpO1xuXHRcdHJlY29yZEVkZ2VUcmFjZShlZGdlLmlkLCBzcGFuLnNwYW5Db250ZXh0KCkudHJhY2VJZCk7XG5cdFx0aWYgKGVkZ2Uua2luZCAhPT0gJ2NhbGwnICYmIGVkZ2Uua2luZCAhPT0gJ21ldGhvZCcgJiYgZWRnZS5raW5kICE9PSAnY29uc3RydWN0Jykge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRjb25zdCBtYXRjaCA9IENBTExTSVRFX1JFLmV4ZWMoZWRnZS5uYW1lKTtcblx0XHRpZiAoIW1hdGNoKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHNwYW4uc2V0QXR0cmlidXRlKCdjb2RlLmZpbGVwYXRoJywgbWF0Y2hbIDEgXSk7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2NvZGUubGluZW5vJywgTnVtYmVyKG1hdGNoWyAyIF0pKTtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnY29kZS5jb2x1bW4nLCBOdW1iZXIobWF0Y2hbIDMgXSkpO1xuXHR9XG5cblx0Ly8gV2FsayBkaXZlJ3MgcGFyZW50YWdlIHRvIHRoZSByb290IGVkZ2UgaWQuIFBhcmVudHMgYXJlIHJlY29yZGVkIGFzXG5cdC8vIGVkZ2VzIGFycml2ZSAoZW50ZXIgZmlyZXMgcGFyZW50LWJlZm9yZS1jaGlsZCksIHNvIHRoZSBjaGFpbiBpc1xuXHQvLyBjb21wbGV0ZSBmb3IgYW55dGhpbmcgc3RpbGwgaW4gZmxpZ2h0OyBhbiBldmljdGVkL3Vua25vd24gcGFyZW50XG5cdC8vIHNpbXBseSBlbmRzIHRoZSB3YWxrIGF0IHRoZSBkZWVwZXN0IGtub3duIGlkLlxuXHRwcml2YXRlIHJvb3RFZGdlSWRPZiAoZWRnZTogRmxvd0VkZ2UpOiBudW1iZXIge1xuXHRcdHRoaXMudHJhY2soZWRnZSk7XG5cdFx0dGhpcy5lZGdlUGFyZW50cy5zZXQoZWRnZS5pZCwgZWRnZS5wYXJlbnRJZCk7XG5cdFx0bGV0IHsgaWQgfSA9IGVkZ2U7XG5cdFx0bGV0IHBhcmVudCA9IGVkZ2UucGFyZW50SWQ7XG5cdFx0Y29uc3Qgc2VlbiA9IG5ldyBTZXQ8bnVtYmVyPihbIGlkIF0pO1xuXHRcdHdoaWxlIChwYXJlbnQgIT09IG51bGwgJiYgIXNlZW4uaGFzKHBhcmVudCkpIHtcblx0XHRcdHNlZW4uYWRkKHBhcmVudCk7XG5cdFx0XHRpZCA9IHBhcmVudDtcblx0XHRcdGNvbnN0IG5leHQgPSB0aGlzLmVkZ2VQYXJlbnRzLmdldChwYXJlbnQpO1xuXHRcdFx0cGFyZW50ID0gbmV4dCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IG5leHQ7XG5cdFx0fVxuXHRcdHJldHVybiBpZDtcblx0fVxufVxuIl19