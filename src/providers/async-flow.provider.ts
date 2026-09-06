/**
 * Async-flow provider — the ALS backbone for dive attribution.
 *
 * Design: reports/async-flow-tracking-design.md (2026-09-02).
 *
 * One AsyncLocalStorage carrying a linked list of FlowFrames. The root
 * frame is created per HTTP request by MnemonicaTraceMiddleware (or
 * manually via runInScope). Every dive 'enter' hook pushes a child frame
 * (edgeId = the entering edge); 'leave' restores the parent. ALS
 * propagation then does the tracking for free: an UNWRAPPED async hop
 * (setTimeout, promise continuation, async-generator suspension) fires
 * with the scheduling frame in als.getStore() — the parental dive edge
 * is known without wrapping anything.
 *
 * The scoped pin: the root frame owns a pinSet of context instances
 * (strong refs), filled on enter/create from edge.instance. Lifetime is
 * the request's async executions — when they die, the store and pinSet
 * die with them. edge.instance never derefs to undefined mid-request.
 *
 * Node-only by design: dive imports no async_hooks (Deno/Bun), the
 * adapter is the Node boundary where ALS is free.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { registerHook } from '@mnemonica/dive';
import type {
	DiveCreatePayload,
	DiveEnterPayload,
	DiveLeavePayload,
} from '@mnemonica/dive';

export type FlowFrame = {
	/** the dive edge this frame belongs to (null on the root frame) */
	edgeId   : number | null;
	/** the frame active when this one was entered */
	parent   : FlowFrame | null;
	/** strong pins of context instances — ONE set per scope, shared down
	 *  the chain by reference; dies with the scope's async executions */
	pinSet   : Set<object>;
};

/** Read-only crash-time view of the active frame. */
export type CrashContext = {
	edgeId    : number | null;
	instances : object[];
};

const als = new AsyncLocalStorage<FlowFrame>();

export class AsyncFlowProvider {
	// edgeId → the frame entered for it, so leave restores the exact parent
	private frames = new Map<number, FlowFrame>();
	private detachers: Array<() => void> = [];

	/**
	 * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
	 * double every frame push. Dive's clear() wipes subscribers — re-attach
	 * after it.
	 */
	attach (): void {
		if (this.detachers.length > 0) {
			return;
		}
		this.detachers.push(
			registerHook('enter', (payload) => {
				this.onEnter(payload);
			}),
			registerHook('leave', (payload) => {
				this.onLeave(payload);
			}),
		);
		try {
			this.detachers.push(
				registerHook('create', (payload) => {
					this.onCreate(payload);
				}),
			);
		} catch {
			// 'create' exists since dive 0.8.0; on 0.7.x registerHook throws —
			// skipping preserves exactly the pre-subscription behavior.
		}
	}

	detach (): void {
		for (const detach of this.detachers) {
			detach();
		}
		this.detachers = [];
		this.frames.clear();
	}

	/**
	 * Establish a root frame for non-HTTP scopes (queue consumers, CLI,
	 * tests). The middleware is the HTTP root.
	 */
	runInScope<T> (fn: () => T): T {
		const root: FlowFrame = {
			edgeId : null,
			parent : null,
			pinSet : new Set<object>(),
		};
		const result = als.run(root, fn);
		return result;
	}

	/**
	 * The frame active RIGHT NOW — in an uncaughtException handler this is
	 * the failing execution's frame: the parental edge id plus every
	 * context instance pinned by the scope. Undefined outside any scope.
	 */
	currentFrame (): CrashContext | undefined {
		const frame = als.getStore();
		if (!frame) {
			return undefined;
		}
		const result: CrashContext = {
			edgeId    : frame.edgeId,
			instances : [...frame.pinSet],
		};
		return result;
	}

	private onEnter ({ edge }: DiveEnterPayload): void {
		const current = als.getStore();
		if (!current) {
			return;
		}
		const frame: FlowFrame = {
			edgeId : edge.id,
			parent : current,
			pinSet : current.pinSet,
		};
		if (edge.instance !== undefined) {
			frame.pinSet.add(edge.instance);
		}
		this.frames.set(edge.id, frame);
		als.enterWith(frame);
	}

	private onLeave ({ edge }: DiveLeavePayload): void {
		const frame = this.frames.get(edge.id);
		if (!frame) {
			return;
		}
		this.frames.delete(edge.id);
		if (frame.parent) {
			als.enterWith(frame.parent);
		}
	}

	private onCreate ({ edge }: DiveCreatePayload): void {
		const current = als.getStore();
		if (!current) {
			return;
		}
		// Constructions are one-shot edges (no leave) — no frame of their
		// own, but the constructed instance is DATA: pin it into the scope.
		if (edge.instance !== undefined) {
			current.pinSet.add(edge.instance);
		}
	}
}
