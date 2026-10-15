/**
 * The lineage link — the OTEL join for mnemonica constructions (the JS
 * half of the cross-language contract the Go port ships as otelx and the
 * Python port as mnemonica.otel). The attribute names are shared verbatim
 * across all three, so a trace and a lineage graph join on them — and on
 * the same instance ids, which are core utils.lineage's lazy ids.
 *
 * - stampConstructions(collection) — every construction (successful or
 *   errored) stamps the four contract attributes on the span CURRENT at
 *   construction and records that SpanContext on the instance (WeakMap,
 *   nothing retained past the instance itself).
 * - startLinkedSpan(tracer, name, instance) — a span for work that outlives
 *   the request, LINKED (trace.Link) to the construction span, so
 *   post-request work still joins the request's trace.
 *
 * Stamping is attribute-based (not per-construction spans): span count
 * stays flat, and the request span itself tells the construction story.
 * MnemonicaOtelProvider's per-construction spans remain available
 * independently — the two mechanisms complement, never replace. The error
 * path ('mnemonica.error' + 'mnemonica.lineage.graph') lives in
 * error-analysis.ts; the instance ids stamped here are the same ids that
 * graph carries, so the event and the spans join.
 */
import { type Tracer, type Span, type SpanOptions } from '@opentelemetry/api';
import { type TypesCollection } from 'mnemonica/module';
/**
 * The cross-language attribute contract (shared verbatim with the Go
 * port's otelx and the Python port's otel module): a Jaeger trace and a
 * lineage graph join on these names. The type identity is two fields,
 * matching the lineage graph's `type` shape.
 */
export declare const ATTR_INSTANCE_ID = "mnemonica.instance.id";
export declare const ATTR_PARENT_ID = "mnemonica.parent.id";
export declare const ATTR_TYPE_COLLECTION = "mnemonica.type.collection";
export declare const ATTR_TYPE_PATH = "mnemonica.type.path";
interface InstanceRef {
    id: string;
    collection: string;
    path: string;
}
/**
 * The instance's lineage identity: id (core's lazy lineage id) plus the
 * type's collection and path, derived once and cached per instance.
 * NOTE: core keeps its idOf WeakMap private inside utils.lineage, so the
 * id is derived through the graph export (identical values by construction)
 * and cached above. If core ever exposes idOf directly, instanceRef's body
 * is the single place to switch.
 */
export declare const instanceRef: (instance: object) => InstanceRef;
/**
 * Register the stamping hooks on a collection. Every construction from
 * then on — successful or errored — stamps the four contract attributes on
 * the span current at construction (a request span entered through
 * runInEntryScope, or any context.with(span) scope) and records that
 * SpanContext for startLinkedSpan.
 */
export declare function stampConstructions(collection: TypesCollection): void;
/**
 * Start a span for work on `instance` that outlives the request: when the
 * instance carries a recorded SpanContext (see stampConstructions), the
 * new span is LINKED to the construction span via trace.Link — the worker
 * shows up attached to the request in the trace even though the request is
 * long gone. Without a recorded context it starts a plain span. The caller
 * owns the span's lifetime (end() it).
 */
export declare function startLinkedSpan(tracer: Tracer, name: string, instance: object, options?: SpanOptions): Span;
export {};
//# sourceMappingURL=lineage-link.d.ts.map