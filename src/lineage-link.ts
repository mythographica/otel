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
import {
	trace,
	type Tracer,
	type Span,
	type SpanOptions,
	type SpanContext,
	type Link,
} from '@opentelemetry/api';
import {
	utils,
	getProps,
	type hooksOpts,
	type TypesCollection,
} from 'mnemonica/module';

/**
 * The cross-language attribute contract (shared verbatim with the Go
 * port's otelx and the Python port's otel module): a Jaeger trace and a
 * lineage graph join on these names. The type identity is two fields,
 * matching the lineage graph's `type` shape.
 */
export const ATTR_INSTANCE_ID = 'mnemonica.instance.id';
export const ATTR_PARENT_ID = 'mnemonica.parent.id';
export const ATTR_TYPE_COLLECTION = 'mnemonica.type.collection';
export const ATTR_TYPE_PATH = 'mnemonica.type.path';

// one InstanceRef per instance, ever: the graph builds once, the id is
// core's own lazy id (heads[0] of its utils.lineage export), so ids on
// stamped attributes always equal the ids inside a later error-path graph
interface InstanceRef {
	id        : string;
	collection: string;
	path      : string;
}

const refCache = new WeakMap<object, InstanceRef>();

const isInstance = (value: object): boolean => {
	const instanceCheck = getProps(value) !== undefined;
	return instanceCheck;
};

/**
 * The instance's lineage identity: id (core's lazy lineage id) plus the
 * type's collection and path, derived once and cached per instance.
 * NOTE: core keeps its idOf WeakMap private inside utils.lineage, so the
 * id is derived through the graph export (identical values by construction)
 * and cached above. If core ever exposes idOf directly, instanceRef's body
 * is the single place to switch.
 */
export const instanceRef = (instance: object): InstanceRef => {
	let ref = refCache.get(instance);
	if (ref === undefined) {
		const graph = utils.lineage([ instance ]);
		const [ id ] = graph.heads;
		const node = graph.nodes[ id ];
		ref = {
			id,
			collection : node.type.collection,
			path       : node.type.path,
		};
		refCache.set(instance, ref);
	}
	return ref;
};

// the SpanContext current at each instance's construction — WeakMap, so a
// recorded context lives exactly as long as the instance itself
const constructionSpans = new WeakMap<object, SpanContext>();

/**
 * The postCreation/creationError hook: stamp the contract attributes on
 * the current span and record its SpanContext on the instance. Without a
 * current span the hook is a cheap no-op: ids are formatted only when a
 * real span will receive them (same skip-first shape as the Go/Python
 * ports). The parent id is stamped only when the parent is a real
 * mnemonica instance — a root construction's existentInstance is the
 * collection itself, which has no lineage id.
 */
const stamp = (hookData: hooksOpts): void => {
	const instance = hookData.inheritedInstance;
	if (instance == null || typeof instance !== 'object') {
		return;
	}
	const span = trace.getActiveSpan();
	if (!span) {
		return;
	}
	const spanContext = span.spanContext();
	if (!trace.isSpanContextValid(spanContext)) {
		return;
	}
	const ref = instanceRef(instance);
	const attributes: Record<string, string> = {
		[ ATTR_INSTANCE_ID ]     : ref.id,
		[ ATTR_TYPE_COLLECTION ] : ref.collection,
		[ ATTR_TYPE_PATH ]       : ref.path,
	};
	const parent = hookData.existentInstance;
	if (parent != null && typeof parent === 'object' && isInstance(parent)) {
		attributes[ ATTR_PARENT_ID ] = instanceRef(parent).id;
	}
	span.setAttributes(attributes);
	constructionSpans.set(instance, spanContext);
};

/**
 * Register the stamping hooks on a collection. Every construction from
 * then on — successful or errored — stamps the four contract attributes on
 * the span current at construction (a request span entered through
 * runInEntryScope, or any context.with(span) scope) and records that
 * SpanContext for startLinkedSpan.
 */
export function stampConstructions (collection: TypesCollection): void {
	collection.registerHook('postCreation', stamp);
	collection.registerHook('creationError', stamp);
}

/**
 * Start a span for work on `instance` that outlives the request: when the
 * instance carries a recorded SpanContext (see stampConstructions), the
 * new span is LINKED to the construction span via trace.Link — the worker
 * shows up attached to the request in the trace even though the request is
 * long gone. Without a recorded context it starts a plain span. The caller
 * owns the span's lifetime (end() it).
 */
export function startLinkedSpan (
	tracer  : Tracer,
	name    : string,
	instance: object,
	options?: SpanOptions,
): Span {
	const recorded = constructionSpans.get(instance);
	if (recorded !== undefined && trace.isSpanContextValid(recorded)) {
		const existing = options?.links ?? [];
		const link: Link = { context : recorded };
		const linkedOptions: SpanOptions = {
			...options,
			links : [ ...existing, link ],
		};
		const linkedSpan = tracer.startSpan(name, linkedOptions);
		return linkedSpan;
	}
	const plainSpan = tracer.startSpan(name, options);
	return plainSpan;
}
