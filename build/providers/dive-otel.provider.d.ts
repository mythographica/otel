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
import type { Tracer } from '@opentelemetry/api';
export declare class DiveOtelProvider {
    private tracer;
    private spans;
    private edgeParents;
    private edgeRefs;
    private released;
    private detachers;
    constructor(tracer?: Tracer);
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every span. Dive's clear() wipes subscribers — re-attach after it.
     */
    attach(): void;
    detach(): void;
    private onEnter;
    private onLeave;
    private onSettle;
    private onRecontext;
    private onCreate;
    private findParentSpan;
    private closeSpan;
    private track;
    /**
     * Cross-surface attributes every span gets, on every hook path:
     * the edge's trace root id (Jaeger link → mnemographica's Live Trace,
     * Wanted #1), the edgeId→traceId publication for the strategy push
     * channel (Wanted #2), and code.filepath/line/column parsed from the
     * callsite name (Wanted #4).
     */
    private decorateSpan;
    private rootEdgeIdOf;
}
//# sourceMappingURL=dive-otel.provider.d.ts.map