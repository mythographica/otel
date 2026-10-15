/**
 * Optional dive — an app tracing through its own `new Dive()` gets the same
 * spans, lineage and error analysis as the default-dive path, and the two
 * dives never observe each other's work.
 *
 * Pins the DiveApi contract (src/dive-api.ts): every public API that reads
 * or subscribes to dive accepts options.dive and defaults to the default
 * dive.
 *
 * NOTE: dive.clear() wipes hook subscribers on the DEFAULT dive — every
 * test re-attaches after clearing; app dives are created fresh per test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { Dive, getFlow, registerHook, stats, clear } from '@mnemonica/dive';
import { createTypesCollection } from 'mnemonica/module';
import { attachHooks } from '../src/hooks/attach-hooks.js';
import { DiveOtelProvider } from '../src/providers/dive-otel.provider.js';
import { AsyncFlowProvider } from '../src/providers/async-flow.provider.js';
import { captureError, analyseError } from '../src/error-analysis.js';
import { formatFlow, errorContext } from '../src/utils/dive-flow.js';

interface WidgetShape {
	size: number;
	measure: () => number;
}

describe('optional dive (options.dive)', () => {
	let exporter: InMemorySpanExporter;
	let tracerProvider: NodeTracerProvider;

	beforeEach(() => {
		clear();
		exporter = new InMemorySpanExporter();
		tracerProvider = new NodeTracerProvider();
		tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		tracerProvider.register();
	});

	it('attachHooks(collection, { dive }) traces constructions and methods into that dive only', async () => {
		const appDive = new Dive();
		const appOtel = new DiveOtelProvider(tracerProvider.getTracer('test'), { dive : appDive });
		appOtel.attach();
		const collection = createTypesCollection();
		attachHooks(collection, { dive : appDive });

		const Widget = collection.define('Widget', function (this: WidgetShape) {
			this.size = 3;
			// mnemonica methods live on the instance's own immediate prototype —
			// postCreation's wrapInstanceMethods wraps exactly those
			const proto = Object.getPrototypeOf(this) as WidgetShape;
			proto.measure = function (this: WidgetShape) {
				return this.size;
			};
		});
		const widget = new Widget() as WidgetShape;
		const measured = widget.measure();

		expect(measured).toBe(3);
		// the app dive owns the story: create edge + method edge
		const appFlow = appDive.getFlow(widget);
		expect(appFlow.map((edge) => edge.kind)).toEqual([ 'create', 'method' ]);
		// the default dive saw none of it
		expect(stats.recorded).toBe(0);
		expect(getFlow(widget)).toEqual([]);

		await tracerProvider.forceFlush();
		const spans = exporter.getFinishedSpans();
		const names = spans.map((span) => span.name).sort();
		expect(names).toEqual([ 'dive.create:Widget', 'dive.method:measure' ]);
	});

	it('the default dive\'s hooks never fire for an app dive\'s work', () => {
		const appDive = new Dive();
		const defaultEvents: string[] = [];
		registerHook('enter', ({ edge }) => {
			defaultEvents.push(edge.name);
		});
		registerHook('create', ({ edge }) => {
			defaultEvents.push(edge.name);
		});
		const collection = createTypesCollection();
		attachHooks(collection, { dive : appDive });
		const Gadget = collection.define('Gadget', function () {});
		new Gadget();
		expect(defaultEvents).toEqual([]);
		expect(appDive.stats.recorded).toBe(1);
	});

	it('without the option everything lands on the default dive, unchanged', () => {
		const collection = createTypesCollection();
		attachHooks(collection);
		const Sprocket = collection.define('Sprocket', function () {});
		const sprocket = new Sprocket();
		const flow = getFlow(sprocket);
		expect(flow.length).toBe(1);
		expect(flow[ 0 ].kind).toBe('create');
		expect(stats.recorded).toBe(1);
	});

	it('AsyncFlowProvider subscribes to the dive it was given — both providers attached at once', () => {
		const appDive = new Dive();
		const appFlow = new AsyncFlowProvider({ dive : appDive });
		const defaultFlow = new AsyncFlowProvider();
		appFlow.attach();
		defaultFlow.attach();
		const ctx = { id : 'app' };

		// scoped on the app provider: its frames follow the app dive's edges;
		// the default provider — attached at the same time — has no store of
		// its own here and sees nothing
		let appSeen: { edgeId : number | null; instances : object[] } | undefined;
		let defaultSeen: unknown;
		appFlow.runInScope(() => {
			const work = appDive.wrap(function scopedWork () {
				appSeen = appFlow.currentFrame();
				defaultSeen = defaultFlow.currentFrame();
				return 1;
			}, ctx);
			work();
		});
		expect(appSeen?.edgeId).not.toBeNull();
		expect(appSeen?.instances).toEqual([ ctx ]);
		expect(defaultSeen).toBeUndefined();

		// scoped on the default provider: the app dive's edges never become
		// ITS frames — it sees only its own root frame
		let defaultInScope: { edgeId : number | null; instances : object[] } | undefined;
		let appInScope: unknown;
		defaultFlow.runInScope(() => {
			const more = appDive.wrap(function moreWork () {
				defaultInScope = defaultFlow.currentFrame();
				appInScope = appFlow.currentFrame();
				return 2;
			}, ctx);
			more();
		});
		expect(defaultInScope?.edgeId).toBeNull();
		expect(defaultInScope?.instances).toEqual([]);
		expect(appInScope).toBeUndefined();
	});

	it('error analysis reads the trace of the dive it is given', () => {
		const appDive = new Dive();
		const collection = createTypesCollection();
		attachHooks(collection, { dive : appDive });
		const Thing = collection.define('AnalysedThing', function () {});
		const thing = new Thing();
		const boom = new Error('app failure');
		const failing = appDive.wrap(function appFail () {
			throw boom;
		}, thing);
		try {
			failing();
		} catch {
			// pinned by the app dive
		}
		const viaApp = analyseError(captureError(boom, { dive : appDive }));
		expect(viaApp.source).toBe('error');
		expect(viaApp.evidence).toBe(true);
		expect(viaApp.edges.map((edge) => edge.name)).toEqual([ 'AnalysedThing', 'appFail' ]);
		expect(viaApp.instances).toBe(1);
		// the same capture against the default dive finds no trace
		const viaDefault = analyseError(captureError(boom));
		expect(viaDefault.source).toBe('none');
		expect(viaDefault.edges).toEqual([]);
	});

	it('formatFlow and errorContext accept the optional dive', () => {
		const appDive = new Dive();
		const ctx = { id : 'app' };
		const boom = new Error('fmt failure');
		const failing = appDive.wrap(function fmtFail () {
			throw boom;
		}, ctx);
		try {
			failing();
		} catch {
			// pinned by the app dive
		}
		const formatted = formatFlow(ctx, { dive : appDive });
		expect(formatted).toEqual([ { name : 'fmtFail', kind : 'call', status : 'error', duration : formatted[ 0 ].duration } ]);
		// through the default dive the context has no story
		expect(formatFlow(ctx)).toEqual([]);
		expect(errorContext(boom, { dive : appDive })).toBe(ctx);
		// the pin rides on the error object — getErrorInstance reads it from
		// ANY dive by design, so the default dive recovers it too
		expect(errorContext(boom)).toBe(ctx);
	});
});
