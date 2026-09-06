/**
 * runInRequestScope tests — pins the triple scope entry: inside fn() the
 * request span is visible BOTH through the provider's own AsyncLocalStorage
 * (read by mnemonica hooks) AND through the OTEL global context (read by
 * DiveOtelProvider when it looks for a parent span at wrap boundaries),
 * with the async-flow root frame outermost when provided.
 */
import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { context as otelContext, trace } from '@opentelemetry/api';
import type { Span, Tracer } from '@opentelemetry/api';
import { MnemonicaOtelProvider } from '../src/providers/mnemonica-otel.provider.js';
import { AsyncFlowProvider } from '../src/providers/async-flow.provider.js';
import { runInRequestScope, type HttpRequestLike, type HttpResponseLike } from '../src/request-scope.js';

const makeReq = (): HttpRequestLike => {
	const req: HttpRequestLike = {
		method : 'GET',
		url    : '/chaos/ok',
	};
	return req;
};

const makeRes = (): HttpResponseLike & EventEmitter => {
	const res = new EventEmitter() as EventEmitter & HttpResponseLike;
	res.statusCode = 200;
	return res;
};

describe('runInRequestScope', () => {
	let exporter: InMemorySpanExporter;
	let tracerProvider: NodeTracerProvider;
	let tracer: Tracer;
	let otel: MnemonicaOtelProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		tracerProvider = new NodeTracerProvider();
		tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		tracerProvider.register();
		tracer = tracerProvider.getTracer('test');
		otel = new MnemonicaOtelProvider(tracer);
	});

	it('exposes the request span via provider ALS inside fn()', () => {
		const res = makeRes();

		let seen: Span | undefined;
		runInRequestScope(makeReq(), res, { tracer, otel }, () => {
			seen = otel.getCurrentSpan();
		});

		expect(seen).toBeDefined();
		expect(otel.getCurrentSpan()).toBeUndefined();
	});

	it('exposes the request span via OTEL global context inside fn()', () => {
		const res = makeRes();

		let seen: Span | undefined;
		let alsSpan: Span | undefined;
		runInRequestScope(makeReq(), res, { tracer, otel }, () => {
			seen = trace.getSpan(otelContext.active());
			alsSpan = otel.getCurrentSpan();
		});

		expect(seen).toBeDefined();
		expect(alsSpan).toBeDefined();
		// same span on both sides — dive and mnemonica hooks share the parent
		expect(seen!.spanContext().spanId).toBe(alsSpan!.spanContext().spanId);
	});

	it('opens the async-flow root frame outermost when the provider is given', () => {
		const res = makeRes();
		const asyncFlow = new AsyncFlowProvider();

		let frameEdge: number | null | undefined;
		let spanSeen: Span | undefined;
		runInRequestScope(makeReq(), res, { tracer, otel, asyncFlow }, () => {
			frameEdge = asyncFlow.currentFrame()?.edgeId;
			spanSeen = otel.getCurrentSpan();
		});

		// root frame: no edge of its own, but the scope exists
		expect(frameEdge).toBeNull();
		expect(spanSeen).toBeDefined();
		expect(asyncFlow.currentFrame()).toBeUndefined();
	});

	it('ends the span with http.status_code on response finish', async () => {
		const res = makeRes();
		res.statusCode = 201;

		runInRequestScope(makeReq(), res, { tracer, otel }, () => {});
		res.emit('finish');

		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('HTTP GET /chaos/ok');
		expect(spans[0].attributes['http.method']).toBe('GET');
		expect(spans[0].attributes['http.status_code']).toBe(201);
	});
});
