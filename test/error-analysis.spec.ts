/**
 * Error analysis tests — error → its dive edge → its instances.
 *
 * Crash boundaries (the real uncaughtException / unhandledRejection
 * handlers) run in a plain node child — vitest intercepts uncaught errors,
 * so the handler truth lives in test/fixtures/error-analysis-child.mjs
 * (one JSON line per case, asserted here). Everything else runs in-process
 * against the sources, the budget, and the span recorder.
 *
 * Source (b) evidence rests on retention: dive's enter payload hands the
 * LIVE edge, and the ALS-propagated timer keeps the frame (and the edge,
 * plus its ancestors through dive's parent links) alive until the callback
 * fires — so getFlow(frame.edge) cannot come back empty while the frame
 * exists. There is no "collected edge" path to test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTypesCollection } from 'mnemonica/module';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { wrap, clear } from '@mnemonica/dive';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { attachHooks } from '../src/hooks/attach-hooks.js';
import {
	captureError,
	analyseError,
	recordErrorAnalysis,
	type ErrorAnalysis,
} from '../src/error-analysis.js';

const require = createRequire(import.meta.url);
const schemaPath = require.resolve('@mnemonica/lethe/lineage.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020();
const validateGraph = ajv.compile(schema);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'error-analysis-child.mjs');

const runCase = (name: string): Record<string, unknown> => {
	const out = execFileSync(process.execPath, [fixture, name], {
		encoding   : 'utf8',
		env        : { ...process.env, NODE_OPTIONS: '--expose-gc' },
	});
	const line = out.trim().split('\n').pop() ?? '{}';
	const parsed = JSON.parse(line) as Record<string, unknown>;
	return parsed;
};

interface RootShape {
	id: string;
}

// two sibling roots: the chain gets one create edge plus the calls, and
// the budget test gets two distinct instances without subtype ceremony
const buildChain = () => {
	clear();
	const collection = createTypesCollection();
	attachHooks(collection);
	const Root = collection.define('ChainRoot', function (this: RootShape, id: string) {
		this.id = id;
	});
	const rootA = new Root('a');
	const rootB = new Root('b');
	return { rootA, rootB };
};

describe('error analysis — sources', () => {

	beforeEach(() => {
		clear();
	});

	it('(a) an error pinned by dive itself: evidence, the full chain, one lineage graph', () => {
		const { rootA } = buildChain();
		function inner () {
			throw new Error('a-source boom');
		}
		function outer () {
			wrap(inner, rootA)();
		}
		let caught: unknown;
		try {
			wrap(outer, rootA)();
		} catch (error) {
			caught = error;
		}

		const analysis = analyseError(captureError(caught));
		expect(analysis.source).toBe('error');
		expect(analysis.evidence).toBe(true);
		expect(analysis.message).toBe('a-source boom');
		// chain: the root construction, then the two calls (oldest first)
		expect(analysis.edges.map((edge) => `${edge.kind}:${edge.name}`))
			.toEqual(['create:ChainRoot', 'call:outer', 'call:inner']);
		// the construction edge is 'ok'; the calls the error passed through
		// are 'error'
		expect(analysis.edges[0].status).toBe('ok');
		expect(analysis.edges.slice(1).every((edge) => edge.status === 'error')).toBe(true);
		expect(analysis.lineage).not.toBeNull();
		expect(validateGraph(analysis.lineage)).toBe(true);
		expect(analysis.instances).toBe(1);
		expect(analysis.instancesSkipped).toBe(0);
		expect(analysis.edgesTruncated).toBe(0);
	});

	it('(b) the ALS frame at crash time: timer throw inside runInEntryScope + asyncFlow — evidence (child process)', () => {
		const result = runCase('timer');
		expect(result.source).toBe('async-frame');
		expect(result.evidence).toBe(true);
		expect(result.edgeNames).toEqual(['create:Root', 'call:schedulerTimer']);
		expect(result.hasLineage).toBe(true);
	});

	it('(b) the ALS frame at crash time: floating rejection — evidence (child process)', () => {
		const result = runCase('rejection');
		expect(result.source).toBe('async-frame');
		expect(result.evidence).toBe(true);
		expect(result.edgeNames).toEqual(['create:Root', 'call:fireAndForget']);
		expect(result.hasLineage).toBe(true);
	});

	it('(c) the rest residue: a top-level construction, then a jump-over without a scope — a labelled guess', () => {
		const result = runCase('last-context');
		expect(result.source).toBe('last-context');
		expect(result.evidence).toBe(false);
		expect(result.edgeNames).toEqual(['create:Root', 'call:schedulerResidue']);
	});

	it('(d) nothing to attribute: plain error, no dive state', () => {
		const analysis = analyseError(captureError(new Error('plain boom')));
		expect(analysis.source).toBe('none');
		expect(analysis.evidence).toBe(false);
		expect(analysis.edges).toEqual([]);
		expect(analysis.lineage).toBeNull();
		expect(analysis.instances).toBe(0);
	});

	it('(a) wins over (c): a pinned error beats the residue', () => {
		const { rootA } = buildChain();
		function failing () {
			throw new Error('pinned beats residue');
		}
		let caught: unknown;
		try {
			wrap(failing, rootA)();
		} catch (error) {
			caught = error;
		}
		const analysis = analyseError(captureError(caught));
		expect(analysis.source).toBe('error');
		expect(analysis.evidence).toBe(true);
	});

	it('the error itself IS a failed mnemonica construction: type name + attempted args', () => {
		const collection = createTypesCollection();
		const Failing = collection.define('FailingThing', function () {
			throw new Error('construction boom');
		});
		let caught: unknown;
		try {
			new Failing({ marker: 'corner-cut' });
		} catch (error) {
			caught = error;
		}
		const analysis = analyseError(captureError(caught));
		expect(analysis.failedConstruction).toBeDefined();
		expect(analysis.failedConstruction?.typeName).toBe('FailingThing');
		expect(analysis.failedConstruction?.attemptedArgs).toEqual([{ marker: 'corner-cut' }]);
	});
});

describe('error analysis — budget and silence', () => {
	beforeEach(() => {
		clear();
	});

	it('truncation is reported, never silent: chain tail kept, instances capped', () => {
		const { rootA, rootB } = buildChain();
		function level3 () {
			throw new Error('budget boom');
		}
		function level2 () {
			wrap(level3, rootB)();
		}
		function level1 () {
			wrap(level2, rootB)();
		}
		let caught: unknown;
		try {
			wrap(level1, rootA)();
		} catch (error) {
			caught = error;
		}

		const analysis = analyseError(captureError(caught), { maxEdges: 3, maxInstances: 1 });
		// full chain is create:ChainRoot + 3 calls = 4; the failure-proximal
		// TAIL is kept (level1..level3), the cut is reported
		expect(analysis.edges.length).toBe(3);
		expect(analysis.edges.map((edge) => edge.name)).toEqual(['level1', 'level2', 'level3']);
		expect(analysis.edgesTruncated).toBe(1);
		// distinct live instances: rootA (create + level1) and rootB
		// (level2 + level3); capped at 1
		expect(analysis.instances).toBe(1);
		expect(analysis.instancesTruncated).toBe(1);
		expect(analysis.lineage).not.toBeNull();
		expect(validateGraph(analysis.lineage)).toBe(true);
	});

	it('nothing writes to the console: capture + analyse + record are silent', () => {
		const { rootA } = buildChain();
		function failing () {
			throw new Error('silent boom');
		}
		let caught: unknown;
		try {
			wrap(failing, rootA)();
		} catch (error) {
			caught = error;
		}

		const exporter = new InMemorySpanExporter();
		const provider = new NodeTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		const span = provider.getTracer('test').startSpan('boundary');

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const capture = captureError(caught);
			const analysis = analyseError(capture);
			recordErrorAnalysis(analysis, span);
		} finally {
			logSpy.mockRestore();
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
		expect(logSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		span.end();
	});
});

describe('recordErrorAnalysis — on a span the caller passes', () => {
	it('one mnemonica.error event: lineage graph JSON, source, evidence', async () => {
		clear();
		const { rootA } = buildChain();
		function failing () {
			throw new Error('span boom');
		}
		let caught: unknown;
		try {
			wrap(failing, rootA)();
		} catch (error) {
			caught = error;
		}

		const exporter = new InMemorySpanExporter();
		const provider = new NodeTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		const span = provider.getTracer('test').startSpan('error-boundary');

		const analysis: ErrorAnalysis = analyseError(captureError(caught));
		recordErrorAnalysis(analysis, span);
		span.end();
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		const event = spans[0].events.find((e) => e.name === 'mnemonica.error');
		expect(event).toBeDefined();
		expect(event!.attributes['mnemonica.error.source']).toBe('error');
		expect(event!.attributes['mnemonica.error.evidence']).toBe(true);

		const graphRaw = event!.attributes['mnemonica.lineage.graph'] as string;
		expect(typeof graphRaw).toBe('string');
		const graph = JSON.parse(graphRaw);
		expect(validateGraph(graph)).toBe(true);
		expect(graph.heads.length).toBe(1);
	});
});
