/**
 * OpenTelemetry integration tests for @mnemonica/otel.
 *
 * Uses InMemorySpanExporter to verify span creation,
 * nesting, and attributes without a real OTel collector.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { createTypesCollection } from 'mnemonica/module';
import type { TypesCollection } from 'mnemonica/module';
import { MnemonicaOtelProvider } from '../src/providers/mnemonica-otel.provider.js';

describe('MnemonicaOtelProvider', () => {
	let exporter: InMemorySpanExporter;
	let provider: NodeTracerProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new NodeTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		provider.register();
	});

	it('creates a span for postCreation hook', async () => {
		const tracer = provider.getTracer('test');
		const otel = new MnemonicaOtelProvider(tracer);
		const collection: TypesCollection = createTypesCollection();

		otel.attachHooks(collection);

		const MyType = collection.define('MyType', function () {});
		new MyType();

		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('mnemonica.MyType');
		expect(spans[0].attributes['mnemonica.type_name']).toBe('MyType');
		expect(spans[0].attributes['mnemonica.hook']).toBe('postCreation');
	});

	it('nests child spans under parent instance spans', async () => {
		const tracer = provider.getTracer('test');
		const otel = new MnemonicaOtelProvider(tracer);
		const collection: TypesCollection = createTypesCollection();

		otel.attachHooks(collection);

		const Parent = collection.define('Parent', function () {});
		const parent = new Parent();
		const Child = Parent.define('Child', function () {});
		new parent.Child();

		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(2);

		const parentSpan = spans.find((s) => s.name === 'mnemonica.Parent');
		const childSpan = spans.find((s) => s.name === 'mnemonica.Child');

		expect(parentSpan).toBeDefined();
		expect(childSpan).toBeDefined();
		expect(childSpan!.parentSpanId).toBe(parentSpan!.spanContext().spanId);
	});

	it('records exception on creationError', async () => {
		const tracer = provider.getTracer('test');
		const otel = new MnemonicaOtelProvider(tracer);
		const collection: TypesCollection = createTypesCollection({ blockErrors: true });

		otel.attachHooks(collection);

		const MyType = collection.define('MyType', function () {
			throw new Error('intentional failure');
		});
		try {
			new MyType();
		} catch {
			// expected
		}

		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('mnemonica.MyType');
		expect(spans[0].attributes['mnemonica.hook']).toBe('creationError');
		expect(spans[0].events.length).toBeGreaterThan(0);
		expect(spans[0].events[0].name).toBe('exception');
	});

	it('has zero overhead when no tracer is used', () => {
		const otel = new MnemonicaOtelProvider(undefined);
		const collection: TypesCollection = createTypesCollection();

		// Should not throw even with undefined tracer
		expect(() => otel.attachHooks(collection)).not.toThrow();

		const MyType = collection.define('MyType', function () {});
		expect(() => new MyType()).not.toThrow();
	});

	it('keeps sibling spans separate when async constructions interleave', async () => {
		const tracer = provider.getTracer('test');
		const otel = new MnemonicaOtelProvider(tracer);
		const collection: TypesCollection = createTypesCollection();

		otel.attachHooks(collection);

		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

		const Parent = collection.define('Parent', function () {});
		const parent = new Parent();
		const ChildA = Parent.define('ChildA', async function (_ms: number) {
			await sleep(_ms);
			return this;
		});
		const ChildB = Parent.define('ChildB', async function (_ms: number) {
			await sleep(_ms);
			return this;
		});

		// A starts first but finishes last: preA, preB, postB, postA.
		// Pending spans keyed on the shared parent would collide here —
		// spanA would leak and a zero-length fallback exported instead.
		const pendingA = new parent.ChildA(50);
		const pendingB = new parent.ChildB(5);
		await Promise.all([pendingA, pendingB]);

		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		const spanA = spans.find((s) => s.name === 'mnemonica.ChildA');
		const spanB = spans.find((s) => s.name === 'mnemonica.ChildB');
		expect(spanA).toBeDefined();
		expect(spanB).toBeDefined();

		// A's span must cover the whole construction (~50ms), not start at
		// postCreation time as a fallback would.
		const durationMs = (s: NonNullable<typeof spanA>) =>
			(s.endTime[0] - s.startTime[0]) * 1e3 + (s.endTime[1] - s.startTime[1]) / 1e6;
		expect(durationMs(spanA!)).toBeGreaterThan(40);
		expect(durationMs(spanB!)).toBeGreaterThan(0);
	});
});
