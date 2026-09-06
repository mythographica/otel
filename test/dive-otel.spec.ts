/**
 * DiveOtelProvider tests — spans for EVERY wrapped call, parented on dive's
 * own trace parentage; async spans close at settle, not at the sync head.
 *
 * Uses InMemorySpanExporter, same pattern as mnemonica-otel.spec.ts.
 * NOTE: dive.clear() wipes hook subscribers — every test re-attaches after
 * clearing, so dive state never leaks between specs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { wrap, clear, recordCreation, recordCreationError } from '@mnemonica/dive';
import { DiveOtelProvider } from '../src/providers/dive-otel.provider.js';

describe('DiveOtelProvider', () => {
	let exporter: InMemorySpanExporter;
	let tracerProvider: NodeTracerProvider;
	let diveOtel: DiveOtelProvider;

	beforeEach(() => {
		clear();
		exporter = new InMemorySpanExporter();
		tracerProvider = new NodeTracerProvider();
		tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		tracerProvider.register();
		diveOtel = new DiveOtelProvider(tracerProvider.getTracer('test'));
		diveOtel.attach();
	});

	it('spans a sync wrapped call', async () => {
		const ctx = { name: 'ctx' };
		const wrapped = wrap(function loadData () {
			return 42;
		}, ctx);
		const result = wrapped();

		expect(result).toBe(42);
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('dive.call:loadData');
		expect(spans[0].attributes['dive.kind']).toBe('call');
		expect(spans[0].attributes['dive.name']).toBe('loadData');
		expect(spans[0].attributes['dive.status']).toBe('ok');
		expect(typeof spans[0].attributes['dive.duration_ms']).toBe('number');
	});

	it('nests child spans on dive trace parentage, not ALS', async () => {
		const ctx = { name: 'ctx' };
		const inner = wrap(function deepLoad () {
			return 'deep';
		}, ctx);
		const outer = wrap(function shallowLoad () {
			const result = inner();
			return result;
		}, ctx);
		const result = outer();

		expect(result).toBe('deep');
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(2);
		const innerSpan = spans.find((span) => span.name === 'dive.call:deepLoad');
		const outerSpan = spans.find((span) => span.name === 'dive.call:shallowLoad');
		expect(innerSpan).toBeDefined();
		expect(outerSpan).toBeDefined();
		expect(innerSpan?.parentSpanId).toBe(outerSpan?.spanContext().spanId);
	});

	it('an async span is NOT finished at the sync close — settle ends it', async () => {
		const ctx = { name: 'ctx' };
		const wrapped = wrap(async function fetchAll () {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return 'rows';
		}, ctx);

		const pending = wrapped();
		expect(exporter.getFinishedSpans().length).toBe(0);

		const result = await pending;
		expect(result).toBe('rows');
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('dive.call:fetchAll');
		expect(spans[0].attributes['dive.status']).toBe('ok');
	});

	it('a rejected chain closes the span with ERROR status and the exception', async () => {
		const ctx = { name: 'ctx' };
		const failure = new Error('db gone');
		const wrapped = wrap(async function saveAll (): Promise<unknown> {
			throw failure;
		}, ctx);

		await expect(wrapped()).rejects.toThrow('db gone');
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].attributes['dive.status']).toBe('error');
		expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
	});

	it('a sync throw still closes the span with ERROR status', async () => {
		const ctx = { name: 'ctx' };
		const wrapped = wrap(function explode (): unknown {
			throw new Error('sync boom');
		}, ctx);

		expect(() => wrapped()).toThrow('sync boom');
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
	});

	it('a re-wrap handoff produces a one-shot recontext span', async () => {
		const first = { name: 'first' };
		const second = { name: 'second' };
		const wrapped = wrap(function handler () {
			return 1;
		}, first);
		wrap(wrapped, second);

		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('dive.recontext:handler');
		expect(spans[0].attributes['dive.handoff']).toBe(true);
	});

	it('a boundary call adopts the active OTel span as parent', async () => {
		const tracer = tracerProvider.getTracer('test');
		const root = tracer.startSpan('http.request');

		const ctx = { name: 'ctx' };
		const wrapped = wrap(function handler () {
			return 'ok';
		}, ctx);

		otelContext.with(trace.setSpan(otelContext.active(), root), () => {
			wrapped();
		});
		root.end();
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		const diveSpan = spans.find((span) => span.name === 'dive.call:handler');
		expect(diveSpan?.parentSpanId).toBe(root.spanContext().spanId);
	});

	it('a recorded construction produces a one-shot create span', async () => {
		const instance = { name: 'thing' };
		recordCreation('Thing', instance);
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('dive.create:Thing');
		expect(spans[0].attributes['dive.kind']).toBe('create');
		expect(spans[0].attributes['dive.name']).toBe('Thing');
		expect(spans[0].attributes['dive.status']).toBe('ok');
		// the hook moment IS the completion — duration is recorded as 0
		expect(spans[0].attributes['dive.duration_ms']).toBe(0);
	});

	it('a construction inside a wrapped call joins the call’s trace', async () => {
		const ctx = { name: 'ctx' };
		const wrapped = wrap(function build () {
			const instance = { made: true };
			recordCreation('Made', instance);
			return instance;
		}, ctx);
		wrapped();
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(2);
		const callSpan = spans.find((span) => span.name === 'dive.call:build');
		const createSpan = spans.find((span) => span.name === 'dive.create:Made');
		expect(callSpan).toBeDefined();
		expect(createSpan).toBeDefined();
		expect(createSpan?.parentSpanId).toBe(callSpan?.spanContext().spanId);
	});

	it('a failed construction closes its create span with ERROR status', async () => {
		const failure = new Error('ctor boom');
		recordCreationError('Broken', failure);
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('dive.create:Broken');
		expect(spans[0].attributes['dive.status']).toBe('error');
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
	});

	it('attach is idempotent; detach stops the spans', async () => {
		diveOtel.attach();

		const ctx = { name: 'ctx' };
		const wrapped = wrap(function fn () {
			return 1;
		}, ctx);
		wrapped();
		await tracerProvider.forceFlush();
		expect(exporter.getFinishedSpans().length).toBe(1);

		diveOtel.detach();
		wrapped();
		await tracerProvider.forceFlush();
		expect(exporter.getFinishedSpans().length).toBe(1);
	});
});
