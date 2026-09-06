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
import type { Span, Tracer } from '@opentelemetry/api';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import {
	registerHook,
	type DiveCreatePayload,
	type DiveEnterPayload,
	type DiveLeavePayload,
	type DiveRecontextPayload,
	type DiveSettlePayload,
	type FlowEdge,
} from '@mnemonica/dive';

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
type EdgeTraceMap = Map<number, string>;
function edgeTraceMap (): EdgeTraceMap {
	const g = globalThis as { __mnemonicaDiveTraceIds?: EdgeTraceMap };
	if (!g.__mnemonicaDiveTraceIds) {
		g.__mnemonicaDiveTraceIds = new Map();
	}
	const map = g.__mnemonicaDiveTraceIds;
	return map;
}
function recordEdgeTrace (edgeId: number, traceId: string): void {
	const map = edgeTraceMap();
	if (map.has(edgeId)) {
		map.delete(edgeId);
	} else if (map.size >= EDGE_TRACES_LIMIT) {
		// FIFO: the oldest entry dies first — Map iterates insertion order
		const oldest = map.keys().next();
		if (!oldest.done) {
			map.delete(oldest.value);
		}
	}
	map.set(edgeId, traceId);
}

export class DiveOtelProvider {
	private tracer: Tracer;
	// open spans, keyed on dive edge id — drained by leave/settle
	private spans = new Map<number, Span>();
	// edge id → parentId, for the root-edge walk (dive.root_edge_id span
	// attribute). Never drained mid-flight: a completed edge can still
	// parent later children (a create edge adopts the next wrapped call),
	// so the map is bounded coarsely instead.
	private edgeParents = new Map<number, number | null>();
	private static readonly EDGE_PARENTS_LIMIT = 20000;
	private detachers: Array<() => void> = [];

	constructor (tracer?: Tracer) {
		this.tracer = tracer ?? trace.getTracer('@mnemonica/otel');
	}

	/**
	 * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
	 * double every span. Dive's clear() wipes subscribers — re-attach after it.
	 */
	attach (): void {
		if (this.detachers.length > 0) {
			return;
		}
		this.detachers.push(
			registerHook('enter', (payload) => {
				this.onEnter(payload);
			}),
			registerHook('leave', (payload) => {
				this.onLeave(payload);
			}),
			registerHook('settle', (payload) => {
				this.onSettle(payload);
			}),
			registerHook('recontext', (payload) => {
				this.onRecontext(payload);
			}),
		);
		try {
			this.detachers.push(
				registerHook('create', (payload) => {
					this.onCreate(payload);
				}),
			);
		} catch {
			// The 'create' event exists since dive 0.8.0; on 0.7.x registerHook
			// throws on the unknown event. Skipping it there preserves exactly
			// the pre-subscription behavior (constructions stay unspanned), so
			// the widened ^0.7.0 || ^0.8.0 peer range stays honest.
		}
	}

	detach (): void {
		for (const detach of this.detachers) {
			detach();
		}
		this.detachers = [];
	}

	private onEnter ({ edge }: DiveEnterPayload): void {
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

	private onLeave ({ edge, result }: DiveLeavePayload): void {
		if (result instanceof Promise) {
			// async work: the span closes at settle, not at the sync head —
			// "the function returned" is not "the work is done"
			return;
		}
		this.closeSpan(edge);
	}

	private onSettle ({ edge, error }: DiveSettlePayload): void {
		this.closeSpan(edge, error);
	}

	private onRecontext ({ edge, previousContext, context }: DiveRecontextPayload): void {
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

	private onCreate ({ edge, error }: DiveCreatePayload): void {
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
		this.decorateSpan(span, edge);
		if (edge.status === 'error') {
			span.setStatus({ code: SpanStatusCode.ERROR });
			if (error instanceof Error) {
				span.recordException(error);
			}
		}
		span.end();
	}

	private findParentSpan (edge: FlowEdge): Span | undefined {		if (edge.parentId !== null) {
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

	private closeSpan (edge: FlowEdge, error?: unknown): void {
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

	/**
	 * Cross-surface attributes every span gets, on every hook path:
	 * the edge's trace root id (Jaeger link → mnemographica's Live Trace,
	 * Wanted #1), the edgeId→traceId publication for the strategy push
	 * channel (Wanted #2), and code.filepath/line/column parsed from the
	 * callsite name (Wanted #4).
	 */
	private decorateSpan (span: Span, edge: FlowEdge): void {
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
	private rootEdgeIdOf (edge: FlowEdge): number {
		if (this.edgeParents.size >= DiveOtelProvider.EDGE_PARENTS_LIMIT) {
			this.edgeParents.clear();
		}
		this.edgeParents.set(edge.id, edge.parentId);
		let id = edge.id;
		let parent = edge.parentId;
		const seen = new Set<number>([id]);
		while (parent !== null && !seen.has(parent)) {
			seen.add(parent);
			id = parent;
			const next = this.edgeParents.get(parent);
			parent = next === undefined ? null : next;
		}
		return id;
	}
}
