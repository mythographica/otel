/**
 * Unblinder core tests — the framework-free report builder + telemetry.
 * The report shape and the [unblind] marker are a downstream contract
 * (pinned by downstream consumers — runbooks grep the marker,
 * framework adapters pin the shape).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { SpanStatusCode } from '@opentelemetry/api';
import { clear } from '@mnemonica/dive';
import { createTypesCollection } from 'mnemonica/module';
import { attachHooks } from '../src/index.js';
import {
	buildUnblindReport,
	recordUnblindTelemetry,
	stringifySafe,
} from '../src/unblind.js';

describe('buildUnblindReport', () => {
	beforeEach(() => clear());

	it('answers a plain Error with an empty-branch report', () => {
		const report = buildUnblindReport(new Error('plain boom'));
		expect(report).toEqual({
			kind            : 'caught-unblinded',
			message         : 'plain boom',
			branch          : [],
			erroredType     : null,
			erroredInstance : null,
			attemptedArgs   : null,
		});
	});

	it('recovers the errored construction: type, parent instance, attempted args', () => {
		const collection = createTypesCollection();
		attachHooks(collection);
		const Root = collection.define('UnblindRoot', function (this: { id: string }, id: string) {
			this.id = id;
		});
		Root.define('UnblindBroken', function (this: { ok: boolean }, data: { ok: boolean }) {
			this.ok = data.ok;
			throw new Error('sanity failed');
		});
		const parent = new Root('r1');

		let caught: Error | undefined;
		try {
			// @ts-expect-error — subtype constructor exists at runtime via define
			new parent.UnblindBroken({ ok: false, marker: 'corner-cut-payload' });
		} catch (error) {
			caught = error as Error;
		}
		expect(caught).toBeInstanceOf(Error);

		const report = buildUnblindReport(caught);
		expect(report.kind).toBe('caught-unblinded');
		expect(report.erroredType).toBe('UnblindBroken');
		expect(report.branch).toContain('create:UnblindBroken');
		// the errored edge attributes the PARENT instance
		expect(report.erroredInstance).toEqual({ id: 'r1' });
		// the attempted constructor args ride the errored instance itself
		expect(report.attemptedArgs).toEqual([{ ok: false, marker: 'corner-cut-payload' }]);
	});

	it('reports a non-Error throw truthfully, never dressed as an Error', () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		const report = buildUnblindReport(circular);

		expect(report.kind).toBe('caught-unblinded');
		expect(report.message).toBe('non-Error thrown (object)');
		expect(report.branch).toEqual([]);
	});
});

describe('stringifySafe', () => {
	it('degrades circular values to a marker instead of throwing', () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(stringifySafe(circular)).toBe('"[unserializable report payload]"');
	});
});

describe('recordUnblindTelemetry', () => {
	// ONE global tracer provider per file: register() is a no-op after the
	// first call, so a second provider would silently orphan its exporter —
	// the code under test resolves the GLOBAL tracer via trace.getTracer.
	const exporter = new InMemorySpanExporter();
	let registered = false;

	beforeEach(() => {
		clear();
		if (!registered) {
			const tracerProvider = new NodeTracerProvider();
			tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
			tracerProvider.register();
			registered = true;
		} else {
			exporter.reset();
		}
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('records an ERROR span and the [unblind] stdout marker', async () => {
		const report = buildUnblindReport(new Error('span boom'));
		recordUnblindTelemetry(report, new Error('span boom'));

		expect(console.log).toHaveBeenCalledTimes(1);
		const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(logged.startsWith('[unblind] ')).toBe(true);

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].name).toBe('mnemonica.caught-exception');
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
	});

	it('marks non-Error throws as an attribute, never recordException', () => {
		const thrown = { not: 'an error' };
		const report = buildUnblindReport(thrown);
		recordUnblindTelemetry(report, thrown);

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		expect(spans[0].attributes['exception.type']).toBe('non-Error-throw');
		expect(spans[0].events.some((event) => event.name === 'exception')).toBe(false);
	});
});
