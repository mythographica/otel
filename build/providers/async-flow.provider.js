/**
 * Async-flow provider — the ALS backbone for dive attribution.
 *
 * Design: reports/async-flow-tracking-design.md.
 *
 * Each provider carries its OWN AsyncLocalStorage holding a linked list of
 * FlowFrames — two providers attached at the same time (a default-dive one
 * and an app-dive one) never read each other's frames. The root frame is
 * created per HTTP request by MnemonicaTraceMiddleware (or manually via
 * runInScope). Every dive 'enter' hook pushes a child frame (edgeId = the
 * entering edge); 'leave' restores the parent. ALS propagation then does
 * the tracking for free: an UNWRAPPED async hop (setTimeout, promise
 * continuation, async-generator suspension) fires with the scheduling
 * frame in als.getStore() — the parental dive edge is known without
 * wrapping anything.
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
import { resolveDive, } from '../dive-api.js';
export class AsyncFlowProvider {
    // edgeId → the frame entered for it, so leave restores the exact parent
    frames = new Map();
    detachers = [];
    // the dive this provider subscribes to — the default dive unless the
    // caller traces through their own
    dive;
    // each provider's OWN store: two attached providers (a default-dive one
    // and an app-dive one) never read each other's frames
    als = new AsyncLocalStorage();
    constructor(options) {
        this.dive = resolveDive(options);
    }
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every frame push. Dive's clear() wipes subscribers — re-attach
     * after it.
     */
    attach() {
        if (this.detachers.length > 0) {
            return;
        }
        this.detachers.push(this.dive.registerHook('enter', (payload) => {
            this.onEnter(payload);
        }), this.dive.registerHook('leave', (payload) => {
            this.onLeave(payload);
        }), this.dive.registerHook('create', (payload) => {
            this.onCreate(payload);
        }));
    }
    detach() {
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
    runInScope(fn) {
        const root = {
            edgeId: null,
            parent: null,
            pinSet: new Set(),
        };
        const result = this.als.run(root, fn);
        return result;
    }
    /**
     * The frame active RIGHT NOW — in an uncaughtException handler this is
     * the failing execution's frame: the parental edge id plus every
     * context instance pinned by the scope. Undefined outside any scope.
     */
    currentFrame() {
        const frame = this.als.getStore();
        if (!frame) {
            return undefined;
        }
        const result = {
            edgeId: frame.edgeId,
            instances: [...frame.pinSet],
        };
        if (frame.edge !== undefined) {
            result.edge = frame.edge;
        }
        return result;
    }
    onEnter({ edge }) {
        const current = this.als.getStore();
        if (!current) {
            return;
        }
        const frame = {
            edgeId: edge.id,
            edge,
            parent: current,
            pinSet: current.pinSet,
        };
        if (edge.instance !== undefined) {
            frame.pinSet.add(edge.instance);
        }
        this.frames.set(edge.id, frame);
        this.als.enterWith(frame);
    }
    onLeave({ edge }) {
        const frame = this.frames.get(edge.id);
        if (!frame) {
            return;
        }
        this.frames.delete(edge.id);
        if (frame.parent) {
            this.als.enterWith(frame.parent);
        }
    }
    onCreate({ edge }) {
        const current = this.als.getStore();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F1Qkc7QUFDSCxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFDaEQsT0FBTyxFQUNOLFdBQVcsR0FHWCxNQUFNLGdCQUFnQixDQUFDO0FBbUN4QixNQUFNLE9BQU8saUJBQWlCO0lBQzdCLHdFQUF3RTtJQUNoRSxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQXFCLENBQUM7SUFDdEMsU0FBUyxHQUFzQixFQUFFLENBQUM7SUFDMUMscUVBQXFFO0lBQ3JFLGtDQUFrQztJQUMxQixJQUFJLENBQVU7SUFDdEIsd0VBQXdFO0lBQ3hFLHNEQUFzRDtJQUM5QyxHQUFHLEdBQUcsSUFBSSxpQkFBaUIsRUFBYSxDQUFDO0lBRWpELFlBQWEsT0FBb0I7UUFDaEMsSUFBSSxDQUFDLElBQUksR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNO1FBQ0wsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvQixPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUNsQixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUMzQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzNDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENB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Q0YsQ0FBQztJQUVPLFFBQVEsQ0FBRSxFQUFFLElBQUksRUFBcUI7UUFDNUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDZCxPQUFPO1FBQ1IsQ0FBQztRQUNELGtFQUFrRTtRQUNsRSxvRUFBb0U7UUFDcEUsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNuQyxDQUFDO0lBQ0YsQ0FBQztDQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBc3luYy1mbG93IHByb3ZpZGVyIOKAlCB0aGUgQUxTIGJhY2tib25lIGZvciBkaXZlIGF0dHJpYnV0aW9uLlxuICpcbiAqIERlc2lnbjogcmVwb3J0cy9hc3luYy1mbG93LXRyYWNraW5nLWRlc2lnbi5tZC5cbiAqXG4gKiBFYWNoIHByb3ZpZGVyIGNhcnJpZXMgaXRzIE9XTiBBc3luY0xvY2FsU3RvcmFnZSBob2xkaW5nIGEgbGlua2VkIGxpc3Qgb2ZcbiAqIEZsb3dGcmFtZXMg4oCUIHR3byBwcm92aWRlcnMgYXR0YWNoZWQgYXQgdGhlIHNhbWUgdGltZSAoYSBkZWZhdWx0LWRpdmUgb25lXG4gKiBhbmQgYW4gYXBwLWRpdmUgb25lKSBuZXZlciByZWFkIGVhY2ggb3RoZXIncyBmcmFtZXMuIFRoZSByb290IGZyYW1lIGlzXG4gKiBjcmVhdGVkIHBlciBIVFRQIHJlcXVlc3QgYnkgTW5lbW9uaWNhVHJhY2VNaWRkbGV3YXJlIChvciBtYW51YWxseSB2aWFcbiAqIHJ1bkluU2NvcGUpLiBFdmVyeSBkaXZlICdlbnRlcicgaG9vayBwdXNoZXMgYSBjaGlsZCBmcmFtZSAoZWRnZUlkID0gdGhlXG4gKiBlbnRlcmluZyBlZGdlKTsgJ2xlYXZlJyByZXN0b3JlcyB0aGUgcGFyZW50LiBBTFMgcHJvcGFnYXRpb24gdGhlbiBkb2VzXG4gKiB0aGUgdHJhY2tpbmcgZm9yIGZyZWU6IGFuIFVOV1JBUFBFRCBhc3luYyBob3AgKHNldFRpbWVvdXQsIHByb21pc2VcbiAqIGNvbnRpbnVhdGlvbiwgYXN5bmMtZ2VuZXJhdG9yIHN1c3BlbnNpb24pIGZpcmVzIHdpdGggdGhlIHNjaGVkdWxpbmdcbiAqIGZyYW1lIGluIGFscy5nZXRTdG9yZSgpIOKAlCB0aGUgcGFyZW50YWwgZGl2ZSBlZGdlIGlzIGtub3duIHdpdGhvdXRcbiAqIHdyYXBwaW5nIGFueXRoaW5nLlxuICpcbiAqIFRoZSBzY29wZWQgcGluOiB0aGUgcm9vdCBmcmFtZSBvd25zIGEgcGluU2V0IG9mIGNvbnRleHQgaW5zdGFuY2VzXG4gKiAoc3Ryb25nIHJlZnMpLCBmaWxsZWQgb24gZW50ZXIvY3JlYXRlIGZyb20gZWRnZS5pbnN0YW5jZS4gTGlmZXRpbWUgaXNcbiAqIHRoZSByZXF1ZXN0J3MgYXN5bmMgZXhlY3V0aW9ucyDigJQgd2hlbiB0aGV5IGRpZSwgdGhlIHN0b3JlIGFuZCBwaW5TZXRcbiAqIGRpZSB3aXRoIHRoZW0uIGVkZ2UuaW5zdGFuY2UgbmV2ZXIgZGVyZWZzIHRvIHVuZGVmaW5lZCBtaWQtcmVxdWVzdC5cbiAqXG4gKiBOb2RlLW9ubHkgYnkgZGVzaWduOiBkaXZlIGltcG9ydHMgbm8gYXN5bmNfaG9va3MgKERlbm8vQnVuKSwgdGhlXG4gKiBhZGFwdGVyIGlzIHRoZSBOb2RlIGJvdW5kYXJ5IHdoZXJlIEFMUyBpcyBmcmVlLlxuICovXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ2FzeW5jX2hvb2tzJztcbmltcG9ydCB7XG5cdHJlc29sdmVEaXZlLFxuXHR0eXBlIERpdmVBcGksXG5cdHR5cGUgRGl2ZU9wdGlvbixcbn0gZnJvbSAnLi4vZGl2ZS1hcGkuanMnO1xuaW1wb3J0IHR5cGUge1xuXHREaXZlQ3JlYXRlUGF5bG9hZCxcblx0RGl2ZUVudGVyUGF5bG9hZCxcblx0RGl2ZUxlYXZlUGF5bG9hZCxcblx0Rmxvd0VkZ2UsXG59IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5cbmV4cG9ydCB0eXBlIEZsb3dGcmFtZSA9IHtcblx0LyoqIHRoZSBkaXZlIGVkZ2UgdGhpcyBmcmFtZSBiZWxvbmdzIHRvIChudWxsIG9uIHRoZSByb290IGZyYW1lKSAqL1xuXHRlZGdlSWQgICA6IG51bWJlciB8IG51bGw7XG5cdC8qKlxuXHQgKiB0aGUgZWRnZSBvYmplY3QgZnJvbSB0aGUgZW50ZXIgcGF5bG9hZCDigJQgZGl2ZSBoYW5kcyB0aGUgTElWRSBlZGdlLCBzb1xuXHQgKiB0aGUgZnJhbWUga2VlcHMgaXQgKGFuZCwgdGhyb3VnaCBkaXZlJ3MgcGFyZW50IGxpbmtzLCBpdHMgYW5jZXN0b3JzKVxuXHQgKiBhbGl2ZSBhcyBsb25nIGFzIHRoZSBzY29wZSdzIGFzeW5jIHdvcmsgbGl2ZXMuIFRoYXQgcmV0ZW50aW9uIGlzIHdoYXRcblx0ICogbWFrZXMgY3Jhc2gtdGltZSBmcmFtZSBhdHRyaWJ1dGlvbiBldmlkZW5jZSwgdGhlIHNhbWUgd2F5IGEgcGVuZGluZ1xuXHQgKiB0aW1lciBrZWVwcyBpdHMgYnJhbmNoLlxuXHQgKi9cblx0ZWRnZT8gICAgOiBGbG93RWRnZTtcblx0LyoqIHRoZSBmcmFtZSBhY3RpdmUgd2hlbiB0aGlzIG9uZSB3YXMgZW50ZXJlZCAqL1xuXHRwYXJlbnQgICA6IEZsb3dGcmFtZSB8IG51bGw7XG5cdC8qKiBzdHJvbmcgcGlucyBvZiBjb250ZXh0IGluc3RhbmNlcyDigJQgT05FIHNldCBwZXIgc2NvcGUsIHNoYXJlZCBkb3duXG5cdCAqICB0aGUgY2hhaW4gYnkgcmVmZXJlbmNlOyBkaWVzIHdpdGggdGhlIHNjb3BlJ3MgYXN5bmMgZXhlY3V0aW9ucyAqL1xuXHRwaW5TZXQgICA6IFNldDxvYmplY3Q+O1xufTtcblxuLyoqIFJlYWQtb25seSBjcmFzaC10aW1lIHZpZXcgb2YgdGhlIGFjdGl2ZSBmcmFtZS4gKi9cbmV4cG9ydCB0eXBlIENyYXNoQ29udGV4dCA9IHtcblx0ZWRnZUlkICAgIDogbnVtYmVyIHwgbnVsbDtcblx0LyoqIHRoZSBlbnRlcmluZyBlZGdlICh0aGUgTElWRSBlZGdlIOKAlCBzdHJvbmdseSBoZWxkIGJ5IHRoZSBmcmFtZSwgc29cblx0ICogIGFsaXZlIHdoZW5ldmVyIHRoZSBmcmFtZSBpcyksIHdoZW4gdGhlIGZyYW1lIGJlbG9uZ3MgdG8gYW4gZWRnZSAqL1xuXHRlZGdlPyAgICAgOiBGbG93RWRnZTtcblx0aW5zdGFuY2VzIDogb2JqZWN0W107XG59O1xuXG5leHBvcnQgY2xhc3MgQXN5bmNGbG93UHJvdmlkZXIge1xuXHQvLyBlZGdlSWQg4oaSIHRoZSBmcmFtZSBlbnRlcmVkIGZvciBpdCwgc28gbGVhdmUgcmVzdG9yZXMgdGhlIGV4YWN0IHBhcmVudFxuXHRwcml2YXRlIGZyYW1lcyA9IG5ldyBNYXA8bnVtYmVyLCBGbG93RnJhbWU+KCk7XG5cdHByaXZhdGUgZGV0YWNoZXJzOiBBcnJheTwoKSA9PiB2b2lkPiA9IFtdO1xuXHQvLyB0aGUgZGl2ZSB0aGlzIHByb3ZpZGVyIHN1YnNjcmliZXMgdG8g4oCUIHRoZSBkZWZhdWx0IGRpdmUgdW5sZXNzIHRoZVxuXHQvLyBjYWxsZXIgdHJhY2VzIHRocm91Z2ggdGhlaXIgb3duXG5cdHByaXZhdGUgZGl2ZTogRGl2ZUFwaTtcblx0Ly8gZWFjaCBwcm92aWRlcidzIE9XTiBzdG9yZTogdHdvIGF0dGFjaGVkIHByb3ZpZGVycyAoYSBkZWZhdWx0LWRpdmUgb25lXG5cdC8vIGFuZCBhbiBhcHAtZGl2ZSBvbmUpIG5ldmVyIHJlYWQgZWFjaCBvdGhlcidzIGZyYW1lc1xuXHRwcml2YXRlIGFscyA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZTxGbG93RnJhbWU+KCk7XG5cblx0Y29uc3RydWN0b3IgKG9wdGlvbnM/OiBEaXZlT3B0aW9uKSB7XG5cdFx0dGhpcy5kaXZlID0gcmVzb2x2ZURpdmUob3B0aW9ucyk7XG5cdH1cblxuXHQvKipcblx0ICogU3Vic2NyaWJlIHRvIGRpdmUncyBlZGdlIGxpZmVjeWNsZS4gSWRlbXBvdGVudDogYXR0YWNoaW5nIHR3aWNlIHdvdWxkXG5cdCAqIGRvdWJsZSBldmVyeSBmcmFtZSBwdXNoLiBEaXZlJ3MgY2xlYXIoKSB3aXBlcyBzdWJzY3JpYmVycyDigJQgcmUtYXR0YWNoXG5cdCAqIGFmdGVyIGl0LlxuXHQgKi9cblx0YXR0YWNoICgpOiB2b2lkIHtcblx0XHRpZiAodGhpcy5kZXRhY2hlcnMubGVuZ3RoID4gMCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycy5wdXNoKFxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygnZW50ZXInLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uRW50ZXIocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHRoaXMuZGl2ZS5yZWdpc3Rlckhvb2soJ2xlYXZlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkxlYXZlKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0XHR0aGlzLmRpdmUucmVnaXN0ZXJIb29rKCdjcmVhdGUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uQ3JlYXRlKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0KTtcblx0fVxuXG5cdGRldGFjaCAoKTogdm9pZCB7XG5cdFx0Zm9yIChjb25zdCBkZXRhY2ggb2YgdGhpcy5kZXRhY2hlcnMpIHtcblx0XHRcdGRldGFjaCgpO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycyA9IFtdO1xuXHRcdHRoaXMuZnJhbWVzLmNsZWFyKCk7XG5cdH1cblxuXHQvKipcblx0ICogRXN0YWJsaXNoIGEgcm9vdCBmcmFtZSBmb3Igbm9uLUhUVFAgc2NvcGVzIChxdWV1ZSBjb25zdW1lcnMsIENMSSxcblx0ICogdGVzdHMpLiBUaGUgbWlkZGxld2FyZSBpcyB0aGUgSFRUUCByb290LlxuXHQgKi9cblx0cnVuSW5TY29wZTxUPiAoZm46ICgpID0+IFQpOiBUIHtcblx0XHRjb25zdCByb290OiBGbG93RnJhbWUgPSB7XG5cdFx0XHRlZGdlSWQgOiBudWxsLFxuXHRcdFx0cGFyZW50IDogbnVsbCxcblx0XHRcdHBpblNldCA6IG5ldyBTZXQ8b2JqZWN0PigpLFxuXHRcdH07XG5cdFx0Y29uc3QgcmVzdWx0ID0gdGhpcy5hbHMucnVuKHJvb3QsIGZuKTtcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0LyoqXG5cdCAqIFRoZSBmcmFtZSBhY3RpdmUgUklHSFQgTk9XIOKAlCBpbiBhbiB1bmNhdWdodEV4Y2VwdGlvbiBoYW5kbGVyIHRoaXMgaXNcblx0ICogdGhlIGZhaWxpbmcgZXhlY3V0aW9uJ3MgZnJhbWU6IHRoZSBwYXJlbnRhbCBlZGdlIGlkIHBsdXMgZXZlcnlcblx0ICogY29udGV4dCBpbnN0YW5jZSBwaW5uZWQgYnkgdGhlIHNjb3BlLiBVbmRlZmluZWQgb3V0c2lkZSBhbnkgc2NvcGUuXG5cdCAqL1xuXHRjdXJyZW50RnJhbWUgKCk6IENyYXNoQ29udGV4dCB8IHVuZGVmaW5lZCB7XG5cdFx0Y29uc3QgZnJhbWUgPSB0aGlzLmFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghZnJhbWUpIHtcblx0XHRcdHJldHVybiB1bmRlZmluZWQ7XG5cdFx0fVxuXHRcdGNvbnN0IHJlc3VsdDogQ3Jhc2hDb250ZXh0ID0ge1xuXHRcdFx0ZWRnZUlkICAgIDogZnJhbWUuZWRnZUlkLFxuXHRcdFx0aW5zdGFuY2VzIDogWyAuLi5mcmFtZS5waW5TZXQgXSxcblx0XHR9O1xuXHRcdGlmIChmcmFtZS5lZGdlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHJlc3VsdC5lZGdlID0gZnJhbWUuZWRnZTtcblx0XHR9XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdHByaXZhdGUgb25FbnRlciAoeyBlZGdlIH06IERpdmVFbnRlclBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBjdXJyZW50ID0gdGhpcy5hbHMuZ2V0U3RvcmUoKTtcblx0XHRpZiAoIWN1cnJlbnQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgZnJhbWU6IEZsb3dGcmFtZSA9IHtcblx0XHRcdGVkZ2VJZCA6IGVkZ2UuaWQsXG5cdFx0XHRlZGdlLFxuXHRcdFx0cGFyZW50IDogY3VycmVudCxcblx0XHRcdHBpblNldCA6IGN1cnJlbnQucGluU2V0LFxuXHRcdH07XG5cdFx0aWYgKGVkZ2UuaW5zdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0ZnJhbWUucGluU2V0LmFkZChlZGdlLmluc3RhbmNlKTtcblx0XHR9XG5cdFx0dGhpcy5mcmFtZXMuc2V0KGVkZ2UuaWQsIGZyYW1lKTtcblx0XHR0aGlzLmFscy5lbnRlcldpdGgoZnJhbWUpO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkxlYXZlICh7IGVkZ2UgfTogRGl2ZUxlYXZlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGZyYW1lID0gdGhpcy5mcmFtZXMuZ2V0KGVkZ2UuaWQpO1xuXHRcdGlmICghZnJhbWUpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5mcmFtZXMuZGVsZXRlKGVkZ2UuaWQpO1xuXHRcdGlmIChmcmFtZS5wYXJlbnQpIHtcblx0XHRcdHRoaXMuYWxzLmVudGVyV2l0aChmcmFtZS5wYXJlbnQpO1xuXHRcdH1cblx0fVxuXG5cdHByaXZhdGUgb25DcmVhdGUgKHsgZWRnZSB9OiBEaXZlQ3JlYXRlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGN1cnJlbnQgPSB0aGlzLmFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghY3VycmVudCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHQvLyBDb25zdHJ1Y3Rpb25zIGFyZSBvbmUtc2hvdCBlZGdlcyAobm8gbGVhdmUpIOKAlCBubyBmcmFtZSBvZiB0aGVpclxuXHRcdC8vIG93biwgYnV0IHRoZSBjb25zdHJ1Y3RlZCBpbnN0YW5jZSBpcyBEQVRBOiBwaW4gaXQgaW50byB0aGUgc2NvcGUuXG5cdFx0aWYgKGVkZ2UuaW5zdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Y3VycmVudC5waW5TZXQuYWRkKGVkZ2UuaW5zdGFuY2UpO1xuXHRcdH1cblx0fVxufVxuIl19