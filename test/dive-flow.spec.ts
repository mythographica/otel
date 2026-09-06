import { describe, it, expect, beforeEach } from 'vitest';
import { wrap, enterContext, clear } from '@mnemonica/dive';
import { createTypesCollection } from 'mnemonica/module';
import { formatFlow, errorContext } from '../src/utils/dive-flow.js';
import { attachHooks } from '../src/index.js';

describe('formatFlow', () => {
	beforeEach(() => {
		clear();
	});

	it('shapes trace edges into JSON-safe records', () => {
		const ctx = { id: 'ctx' };
		const job = wrap(function doJob () { return 1; }, ctx);
		job();

		const flow = formatFlow(ctx);
		expect(flow.length).toBe(1);
		expect(flow[0]).toEqual({
			name     : 'doJob',
			kind     : 'call',
			status   : 'ok',
			duration : flow[0].duration,
		});
		expect(typeof flow[0].duration).toBe('number');
	});

	it('keeps the sync-head duration on running async edges, full lifetime after settle', async () => {
		const ctx = { id: 'ctx' };
		let resolveJob: (v: number) => void = () => undefined;
		const job = wrap(function pendingJob () {
			return new Promise<number>((resolve) => {
				resolveJob = resolve;
			});
		}, ctx);
		const pending = job();

		const running = formatFlow(ctx);
		expect(running[0].status).toBe('running');
		// dive sets duration at the sync head, the tap overwrites at settle
		expect(typeof running[0].duration).toBe('number');

		resolveJob(1);
		await pending;

		const settled = formatFlow(ctx);
		expect(settled[0].status).toBe('ok');
		expect(typeof settled[0].duration).toBe('number');
	});

	it('create edges settle at postCreation (dive 0.6.1)', () => {
		clear();
		const collection = createTypesCollection();
		attachHooks(collection);
		const Root = collection.define('Root', function (this: { id: string }, id: string) {
			this.id = id;
		});
		const instance = new Root('r1');

		// construction completed, so the create edge is honestly closed —
		// forever-'running' was the pre-0.6.1 lie found by the live smoke
		const flow = formatFlow(instance);
		expect(flow[0].kind).toBe('create');
		expect(flow[0].status).toBe('ok');
		expect(flow[0].duration).toBe(0);
	});

	it('never carries the live instance reference', () => {
		const ctx = { id: 'ctx' };
		const job = wrap(() => 1, ctx);
		job();

		const flow = formatFlow(ctx);
		expect(JSON.parse(JSON.stringify(flow))).toEqual(flow);
		expect(Object.keys(flow[0]).sort()).toEqual(['duration', 'kind', 'name', 'status']);
	});
});

describe('errorContext', () => {
	beforeEach(() => {
		clear();
	});

	it('returns the instance pinned to an error that crossed a wrapped boundary', () => {
		const ctx = { id: 'ctx' };
		const failing = wrap(() => {
			throw new Error('boom');
		}, ctx);

		let caught: Error | undefined;
		try {
			failing();
		} catch (error) {
			caught = error as Error;
		}

		expect(caught).toBeDefined();
		expect(errorContext(caught as Error)).toBe(ctx);
	});

	it('falls back to the current ambient context for unpinned errors', () => {
		const ctx = { id: 'ambient' };
		enterContext(ctx);
		const plain = new Error('no edges crossed');
		expect(errorContext(plain)).toBe(ctx);
	});

	it('returns undefined when nothing is pinned and no context is ambient', () => {
		const plain = new Error('nowhere');
		expect(errorContext(plain)).toBeUndefined();
	});
});
