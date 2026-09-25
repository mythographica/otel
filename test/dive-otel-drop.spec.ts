/**
 * DiveOtelProvider vs dive's edge.drop() — the explicit-wipe path.
 *
 * What must hold when a user wipes a trace (edge.drop()):
 *
 *   - OPEN SPANS drain by leave/settle exactly as before — the wipe touches
 *     dive's parent links, not the provider's span lifecycle; a running
 *     edge removed from dive's running store still settles its span
 *     honestly (status/duration read off the edge object itself).
 *   - otel's per-edge maps (edgeRefs/edgeParents) drain through the
 *     provider's OWN FinalizationRegistry once dive's wiped edges are
 *     collected — no dangling entries, no leak beyond the FR's one-task
 *     flush lag.
 *   - root_edge_id stays sane: a fresh story started after the wipe roots
 *     at itself; stale edgeParents entries can only serve ids no new edge
 *     references (drop does not restart ids — only clear() does, and the
 *     WeakRef reuse guard covers that).
 *
 * Requires --expose-gc (the npm test script sets NODE_OPTIONS accordingly).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { wrap, clear, getFlow, getRunningEdges } from '@mnemonica/dive';
import { DiveOtelProvider } from '../src/providers/dive-otel.provider.js';

// private-state probe — structural cast, no any
interface ProviderProbe {
	spans        : Map<number, unknown>;
	edgeParents  : Map<number, unknown>;
	edgeRefs     : Map<number, unknown>;
}

const sleepTick = () => new Promise((resolve) => {
	setTimeout(resolve, 0);
});

async function forceGcRounds (rounds: number): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		globalThis.gc();
		await sleepTick();
	}
	globalThis.gc();
	await sleepTick();
}

describe('DiveOtelProvider — edge.drop interaction', () => {
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

	it('wipe mid-flight: the running span still closes at settle; otel maps drain after GC', async () => {
		const ctx = { name: 'ctx' };
		const slow = wrap(function slowCall () {
			return new Promise((resolve) => {
				setTimeout(resolve, 30);
			});
		}, ctx);
		const pending = slow();
		await sleepTick();

		const running = getRunningEdges();
		expect(running).toHaveLength(1);
		running[0].drop(); // wipe the trace the open span belongs to

		const probe = diveOtel as unknown as ProviderProbe;
		expect(probe.spans.size).toBe(1); // the wipe does NOT close open spans
		await pending;
		expect(probe.spans.size).toBe(0); // settle drains it as usual

		await forceGcRounds(3);
		expect(probe.edgeRefs.size).toBe(0); // FR released every wiped edge
		expect(probe.edgeParents.size).toBe(0);

		await tracerProvider.forceFlush();
		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe('dive.call:slowCall');
		expect(spans[0].attributes['dive.status']).toBe('ok');
		expect(typeof spans[0].attributes['dive.duration_ms']).toBe('number');
	});

	it('post-wipe root ids: a fresh story roots at itself', async () => {
		const ctx = { name: 'ctx' };
		const old = wrap(function oldCall () { return 1; }, ctx);
		old();
		getFlow(ctx)[0].drop(); // wipe the single-edge story
		await forceGcRounds(3);

		const fresh = wrap(function freshCall () { return 2; }, ctx);
		fresh();
		await tracerProvider.forceFlush();

		const spans = exporter.getFinishedSpans();
		const freshSpan = spans.find((s) => s.name === 'dive.call:freshCall');
		expect(freshSpan).toBeDefined();
		expect(freshSpan!.attributes['dive.root_edge_id'])
			.toBe(freshSpan!.attributes['dive.edge_id']);
	});
});
