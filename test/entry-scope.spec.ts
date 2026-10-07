/**
 * Entry scope tests — the neutral boundary (runInEntryScope).
 *
 * Same in-memory-exporter pattern as the other specs: per-test provider,
 * dive.clear() + fresh attach per test (dive.clear() wipes hook
 * subscribers — every test re-attaches, so dive state never leaks).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { wrap, clear } from '@mnemonica/dive';
import { createTypesCollection } from 'mnemonica/module';
import type { TypesCollection } from 'mnemonica/module';
import { runInEntryScope } from '../src/entry-scope.js';
import { MnemonicaOtelProvider } from '../src/providers/mnemonica-otel.provider.js';
import { DiveOtelProvider } from '../src/providers/dive-otel.provider.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('runInEntryScope', () => {
	let exporter: InMemorySpanExporter;
	let provider: NodeTracerProvider;
	let otel: MnemonicaOtelProvider;

	beforeEach(() => {
		clear();
		exporter = new InMemorySpanExporter();
		provider = new NodeTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		provider.register();
		otel = new MnemonicaOtelProvider(provider.getTracer('test'));
	});

	it('ends the span on sync return and passes the result through unchanged', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		const result = runInEntryScope(
			{ name: 'job sync', attributes: { 'job.kind': 'sync' } },
			deps,
			(span) => {
				expect(trace.getSpan(otelContext.active())).toBe(span);
				return 42;
			},
		);

		expect(result).toBe(42);
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job sync');
		expect(spans[0].attributes['job.kind']).toBe('sync');
		expect(spans[0].parentSpanId).toBeUndefined();
		expect(spans[0].status.code).not.toBe(SpanStatusCode.ERROR);
	});

	it('ends the span when the returned promise settles', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		const pending = runInEntryScope({ name: 'job async' }, deps, async () => {
			await sleep(15);
			return 'done';
		});

		// not ended while the work is still running
		expect(exporter.getFinishedSpans().length).toBe(0);

		const result = await pending;
		expect(result).toBe('done');
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job async');
		const durationMs = (spans[0].endTime[0] - spans[0].startTime[0]) * 1e3
			+ (spans[0].endTime[1] - spans[0].startTime[1]) / 1e6;
		expect(durationMs).toBeGreaterThan(10);
	});

	it('a sync throw sets ERROR status, records the exception, and rethrows', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		const boom = new Error('sync boom');
		let caught: unknown;
		try {
			runInEntryScope({ name: 'job throw' }, deps, () => {
				throw boom;
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(boom);
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job throw');
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe('sync boom');
		expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
	});

	it('an async rejection sets ERROR status and rethrows at await', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		const boom = new Error('async boom');
		const pending = runInEntryScope({ name: 'job reject' }, deps, async () => {
			await sleep(5);
			throw boom;
		});

		let caught: unknown;
		try {
			await pending;
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(boom);
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job reject');
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe('async boom');
	});

	it('a non-native thenable is a plain value: same object back, work runs once, span already ended', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		let thenCalls = 0;
		let workRuns = 0;
		// a LAZY thenable: every then() call starts the work again — the
		// entry scope must never call it
		const lazy = {
			tag : 'lazy-query',
			then (onFulfilled: (value: string) => void): void {
				thenCalls += 1;
				workRuns += 1;
				setTimeout(() => {
					onFulfilled('lazy done');
				}, 5);
			},
		};

		const returned = runInEntryScope({ name: 'job lazy' }, deps, () => lazy);

		// the caller gets fn's own object back, and the span is already
		// ended — a non-native thenable does not extend the entry's lifetime
		expect(returned).toBe(lazy);
		await provider.forceFlush();
		let spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job lazy');
		expect(spans[0].status.code).not.toBe(SpanStatusCode.ERROR);
		expect(thenCalls).toBe(0);

		// the caller awaits it: then runs exactly once, the work runs once
		const value = await new Promise<string>((resolve) => {
			lazy.then(resolve);
		});
		expect(value).toBe('lazy done');
		expect(thenCalls).toBe(1);
		expect(workRuns).toBe(1);
		await provider.forceFlush();
		spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
	});

	it('parents a dive-wrapped call and a mnemonica construction inside fn on the entry span', async () => {
		const tracer = provider.getTracer('test');
		const diveOtel = new DiveOtelProvider(tracer);
		diveOtel.attach();

		const collection: TypesCollection = createTypesCollection();
		otel.attachHooks(collection);
		const Entity = collection.define('EntryEntity', function (this: { id: string }, id: string) {
			this.id = id;
		});

		const deps = { tracer, otel };
		let openedSpan: import('@opentelemetry/api').Span | undefined;
		runInEntryScope({ name: 'request' }, deps, (span) => {
			openedSpan = span;
			const ctx = { name: 'ctx' };
			const wrapped = wrap(function loadEntity (this: unknown) {
				return 'loaded';
			}, ctx);
			wrapped();
			new Entity('e1');
		});

		const entrySpan = openedSpan!;
		const entrySpanId = entrySpan.spanContext().spanId;
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		const diveSpan = spans.find((s) => s.name === 'dive.call:loadEntity');
		const constructionSpan = spans.find((s) => s.name === 'mnemonica.EntryEntity');
		expect(diveSpan).toBeDefined();
		expect(constructionSpan).toBeDefined();
		// both adopt the entry span: ALS for the construction, OTEL active
		// context for the boundary dive edge
		expect(constructionSpan!.parentSpanId).toBe(entrySpanId);
		expect(diveSpan!.parentSpanId).toBe(entrySpanId);
		expect(constructionSpan!.spanContext().traceId).toBe(entrySpan.spanContext().traceId);
		expect(diveSpan!.spanContext().traceId).toBe(entrySpan.spanContext().traceId);
	});

	it('with endOnReturn: false the caller ends the span', async () => {
		const tracer = provider.getTracer('test');
		const deps = { tracer, otel };

		const span = runInEntryScope(
			{ name: 'job manual', endOnReturn: false },
			deps,
			(s) => s,
		);

		// still open after fn returned
		expect(exporter.getFinishedSpans().length).toBe(0);

		span.end();
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('job manual');
	});

	it('opens the async-flow root frame when given', async () => {
		const tracer = provider.getTracer('test');
		const { AsyncFlowProvider } = await import('../src/providers/async-flow.provider.js');
		const asyncFlow = new AsyncFlowProvider();

		let frameInside: unknown;
		const result = runInEntryScope(
			{ name: 'job flow' },
			{ tracer, otel, asyncFlow },
			() => {
				frameInside = asyncFlow.currentFrame();
				return 'ok';
			},
		);

		expect(result).toBe('ok');
		// the frame was entered for the duration of fn and closed after
		const currentAfter = asyncFlow.currentFrame();
		expect(frameInside).toBeDefined();
		expect(currentAfter).toBeUndefined();
	});
});
