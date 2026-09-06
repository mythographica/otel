/**
 * AsyncFlowProvider tests — the ALS backbone attributes UNWRAPPED async
 * hops (timers, promise continuations, async-generator suspensions) to
 * the parental dive edge, and pins context instances for the scope's
 * lifetime. Design: reports/async-flow-tracking-design.md.
 *
 * NOTE: dive.clear() wipes hook subscribers — every test re-attaches
 * after clearing (same pattern as dive-otel.spec.ts).
 *
 * Lookup note: edges are found by context identity (copies share the
 * instance getter), not by name — call edges may be named by callsite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wrap, clear, getTrace } from '@mnemonica/dive';
import type { FlowEdge } from '@mnemonica/dive';
import { AsyncFlowProvider } from '../src/providers/async-flow.provider.js';
import type { CrashContext } from '../src/providers/async-flow.provider.js';

function edgeIdOf (ctx: object): number {
	const edge = getTrace().find((item: FlowEdge) => item.instance === ctx);
	if (!edge) {
		throw new Error('no edge for context');
	}
	const result = edge.id;
	return result;
}

describe('AsyncFlowProvider', () => {
	let provider: AsyncFlowProvider;

	beforeEach(() => {
		clear();
		provider = new AsyncFlowProvider();
		provider.attach();
	});

	it('no-ops outside any scope', () => {
		expect(provider.currentFrame()).toBeUndefined();
		const ctx = { id : 'outside' };
		wrap(() => 1, ctx)();
		expect(provider.currentFrame()).toBeUndefined();
	});

	it('an UNWRAPPED setTimeout inside a wrapped call inherits the parental frame', async () => {
		const ctx = { id : 'timer-parent' };
		let seen: CrashContext | undefined;
		const done = new Promise<void>((resolve) => {
			const wrapped = wrap(() => {
				setTimeout(() => {
					seen = provider.currentFrame();
					resolve();
				}, 10);
			}, ctx);
			provider.runInScope(() => wrapped());
		});
		await done;
		expect(seen).toBeDefined();
		expect(seen!.edgeId).toBe(edgeIdOf(ctx));
	});

	it('an UNWRAPPED promise continuation inherits the parental frame', async () => {
		const ctx = { id : 'promise-parent' };
		let seen: CrashContext | undefined;
		const wrapped = wrap(() => {
			return Promise.resolve().then(() => {
				seen = provider.currentFrame();
			});
		}, ctx);
		await provider.runInScope(() => wrapped());
		expect(seen).toBeDefined();
		expect(seen!.edgeId).toBe(edgeIdOf(ctx));
	});

	it('async generator suspensions keep the frame across awaits', async () => {
		const ctx = { id : 'gen-parent' };
		const seen: Array<CrashContext | undefined> = [];
		const tick = (): Promise<void> => {
			const result = new Promise<void>((resolve) => {
				setTimeout(resolve, 5);
			});
			return result;
		};
		async function* gen (): AsyncGenerator<number> {
			await tick();
			seen.push(provider.currentFrame());
			yield 1;
			await tick();
			seen.push(provider.currentFrame());
			yield 2;
		}
		const wrapped = wrap(async () => {
			for await (const _ of gen()) {
				void _;
			}
		}, ctx);
		await provider.runInScope(() => wrapped());
		expect(seen.length).toBe(2);
		for (const frame of seen) {
			expect(frame).toBeDefined();
			expect(frame!.edgeId).toBe(edgeIdOf(ctx));
		}
	});

	it('nested wrapped calls push on enter and restore on leave', async () => {
		const outerCtx = { id : 'outer' };
		const innerCtx = { id : 'inner' };
		let insideInner: CrashContext | undefined;
		let afterInner: CrashContext | undefined;
		const inner = wrap(() => {
			insideInner = provider.currentFrame();
		}, innerCtx);
		const outer = wrap(() => {
			inner();
			afterInner = provider.currentFrame();
		}, outerCtx);
		await provider.runInScope(() => outer());
		expect(insideInner!.edgeId).toBe(edgeIdOf(innerCtx));
		expect(afterInner!.edgeId).toBe(edgeIdOf(outerCtx));
	});

	it('the scoped pin holds context instances for the scope lifetime', async () => {
		const ctx = { id : 'pinned' };
		let seen: CrashContext | undefined;
		const done = new Promise<void>((resolve) => {
			const wrapped = wrap(() => {
				setTimeout(() => {
					seen = provider.currentFrame();
					resolve();
				}, 10);
			}, ctx);
			provider.runInScope(() => wrapped());
		});
		await done;
		expect(seen!.instances).toContain(ctx);
	});
});
