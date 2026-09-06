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
const als = new AsyncLocalStorage();
export class AsyncFlowProvider {
    // edgeId → the frame entered for it, so leave restores the exact parent
    frames = new Map();
    detachers = [];
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every frame push. Dive's clear() wipes subscribers — re-attach
     * after it.
     */
    attach() {
        if (this.detachers.length > 0) {
            return;
        }
        this.detachers.push(registerHook('enter', (payload) => {
            this.onEnter(payload);
        }), registerHook('leave', (payload) => {
            this.onLeave(payload);
        }));
        try {
            this.detachers.push(registerHook('create', (payload) => {
                this.onCreate(payload);
            }));
        }
        catch {
            // 'create' exists since dive 0.8.0; on 0.7.x registerHook throws —
            // skipping preserves exactly the pre-subscription behavior.
        }
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
        const result = als.run(root, fn);
        return result;
    }
    /**
     * The frame active RIGHT NOW — in an uncaughtException handler this is
     * the failing execution's frame: the parental edge id plus every
     * context instance pinned by the scope. Undefined outside any scope.
     */
    currentFrame() {
        const frame = als.getStore();
        if (!frame) {
            return undefined;
        }
        const result = {
            edgeId: frame.edgeId,
            instances: [...frame.pinSet],
        };
        return result;
    }
    onEnter({ edge }) {
        const current = als.getStore();
        if (!current) {
            return;
        }
        const frame = {
            edgeId: edge.id,
            parent: current,
            pinSet: current.pinSet,
        };
        if (edge.instance !== undefined) {
            frame.pinSet.add(edge.instance);
        }
        this.frames.set(edge.id, frame);
        als.enterWith(frame);
    }
    onLeave({ edge }) {
        const frame = this.frames.get(edge.id);
        if (!frame) {
            return;
        }
        this.frames.delete(edge.id);
        if (frame.parent) {
            als.enterWith(frame.parent);
        }
    }
    onCreate({ edge }) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsT0FBTyxFQUFFLGlCQUFpQixFQUFFLE1BQU0sYUFBYSxDQUFDO0FBQ2hELE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQXVCL0MsTUFBTSxHQUFHLEdBQUcsSUFBSSxpQkFBaUIsRUFBYSxDQUFDO0FBRS9DLE1BQU0sT0FBTyxpQkFBaUI7SUFDN0Isd0VBQXdFO0lBQ2hFLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBcUIsQ0FBQztJQUN0QyxTQUFTLEdBQXNCLEVBQUUsQ0FBQztJQUUxQzs7OztPQUlHO0lBQ0gsTUFBTTtRQUNMLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDL0IsT0FBTztRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQ2pDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdkIsQ0FBQyxDQUFDLEVBQ0YsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQ2pDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdkIsQ0FBQyxDQUFDLENBQ0YsQ0FBQztRQUNGLElBQUksQ0FBQztZQUNKLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUNsQixZQUFZLENBQUMsUUFBUSxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUU7Z0JBQ2xDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDeEIsQ0FBQyxDQUFDLENBQ0Ys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LENBQUMsUUFBUSxDQUFDLENBQUM7UUFDbkMsQ0FBQztJQUNGLENBQUM7Q0FDRCIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQXN5bmMtZmxvdyBwcm92aWRlciDigJQgdGhlIEFMUyBiYWNrYm9uZSBmb3IgZGl2ZSBhdHRyaWJ1dGlvbi5cbiAqXG4gKiBEZXNpZ246IHJlcG9ydHMvYXN5bmMtZmxvdy10cmFja2luZy1kZXNpZ24ubWQgKDIwMjYtMDktMDIpLlxuICpcbiAqIE9uZSBBc3luY0xvY2FsU3RvcmFnZSBjYXJyeWluZyBhIGxpbmtlZCBsaXN0IG9mIEZsb3dGcmFtZXMuIFRoZSByb290XG4gKiBmcmFtZSBpcyBjcmVhdGVkIHBlciBIVFRQIHJlcXVlc3QgYnkgTW5lbW9uaWNhVHJhY2VNaWRkbGV3YXJlIChvclxuICogbWFudWFsbHkgdmlhIHJ1bkluU2NvcGUpLiBFdmVyeSBkaXZlICdlbnRlcicgaG9vayBwdXNoZXMgYSBjaGlsZCBmcmFtZVxuICogKGVkZ2VJZCA9IHRoZSBlbnRlcmluZyBlZGdlKTsgJ2xlYXZlJyByZXN0b3JlcyB0aGUgcGFyZW50LiBBTFNcbiAqIHByb3BhZ2F0aW9uIHRoZW4gZG9lcyB0aGUgdHJhY2tpbmcgZm9yIGZyZWU6IGFuIFVOV1JBUFBFRCBhc3luYyBob3BcbiAqIChzZXRUaW1lb3V0LCBwcm9taXNlIGNvbnRpbnVhdGlvbiwgYXN5bmMtZ2VuZXJhdG9yIHN1c3BlbnNpb24pIGZpcmVzXG4gKiB3aXRoIHRoZSBzY2hlZHVsaW5nIGZyYW1lIGluIGFscy5nZXRTdG9yZSgpIOKAlCB0aGUgcGFyZW50YWwgZGl2ZSBlZGdlXG4gKiBpcyBrbm93biB3aXRob3V0IHdyYXBwaW5nIGFueXRoaW5nLlxuICpcbiAqIFRoZSBzY29wZWQgcGluOiB0aGUgcm9vdCBmcmFtZSBvd25zIGEgcGluU2V0IG9mIGNvbnRleHQgaW5zdGFuY2VzXG4gKiAoc3Ryb25nIHJlZnMpLCBmaWxsZWQgb24gZW50ZXIvY3JlYXRlIGZyb20gZWRnZS5pbnN0YW5jZS4gTGlmZXRpbWUgaXNcbiAqIHRoZSByZXF1ZXN0J3MgYXN5bmMgZXhlY3V0aW9ucyDigJQgd2hlbiB0aGV5IGRpZSwgdGhlIHN0b3JlIGFuZCBwaW5TZXRcbiAqIGRpZSB3aXRoIHRoZW0uIGVkZ2UuaW5zdGFuY2UgbmV2ZXIgZGVyZWZzIHRvIHVuZGVmaW5lZCBtaWQtcmVxdWVzdC5cbiAqXG4gKiBOb2RlLW9ubHkgYnkgZGVzaWduOiBkaXZlIGltcG9ydHMgbm8gYXN5bmNfaG9va3MgKERlbm8vQnVuKSwgdGhlXG4gKiBhZGFwdGVyIGlzIHRoZSBOb2RlIGJvdW5kYXJ5IHdoZXJlIEFMUyBpcyBmcmVlLlxuICovXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ2FzeW5jX2hvb2tzJztcbmltcG9ydCB7IHJlZ2lzdGVySG9vayB9IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5pbXBvcnQgdHlwZSB7XG5cdERpdmVDcmVhdGVQYXlsb2FkLFxuXHREaXZlRW50ZXJQYXlsb2FkLFxuXHREaXZlTGVhdmVQYXlsb2FkLFxufSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuXG5leHBvcnQgdHlwZSBGbG93RnJhbWUgPSB7XG5cdC8qKiB0aGUgZGl2ZSBlZGdlIHRoaXMgZnJhbWUgYmVsb25ncyB0byAobnVsbCBvbiB0aGUgcm9vdCBmcmFtZSkgKi9cblx0ZWRnZUlkICAgOiBudW1iZXIgfCBudWxsO1xuXHQvKiogdGhlIGZyYW1lIGFjdGl2ZSB3aGVuIHRoaXMgb25lIHdhcyBlbnRlcmVkICovXG5cdHBhcmVudCAgIDogRmxvd0ZyYW1lIHwgbnVsbDtcblx0LyoqIHN0cm9uZyBwaW5zIG9mIGNvbnRleHQgaW5zdGFuY2VzIOKAlCBPTkUgc2V0IHBlciBzY29wZSwgc2hhcmVkIGRvd25cblx0ICogIHRoZSBjaGFpbiBieSByZWZlcmVuY2U7IGRpZXMgd2l0aCB0aGUgc2NvcGUncyBhc3luYyBleGVjdXRpb25zICovXG5cdHBpblNldCAgIDogU2V0PG9iamVjdD47XG59O1xuXG4vKiogUmVhZC1vbmx5IGNyYXNoLXRpbWUgdmlldyBvZiB0aGUgYWN0aXZlIGZyYW1lLiAqL1xuZXhwb3J0IHR5cGUgQ3Jhc2hDb250ZXh0ID0ge1xuXHRlZGdlSWQgICAgOiBudW1iZXIgfCBudWxsO1xuXHRpbnN0YW5jZXMgOiBvYmplY3RbXTtcbn07XG5cbmNvbnN0IGFscyA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZTxGbG93RnJhbWU+KCk7XG5cbmV4cG9ydCBjbGFzcyBBc3luY0Zsb3dQcm92aWRlciB7XG5cdC8vIGVkZ2VJZCDihpIgdGhlIGZyYW1lIGVudGVyZWQgZm9yIGl0LCBzbyBsZWF2ZSByZXN0b3JlcyB0aGUgZXhhY3QgcGFyZW50XG5cdHByaXZhdGUgZnJhbWVzID0gbmV3IE1hcDxudW1iZXIsIEZsb3dGcmFtZT4oKTtcblx0cHJpdmF0ZSBkZXRhY2hlcnM6IEFycmF5PCgpID0+IHZvaWQ+ID0gW107XG5cblx0LyoqXG5cdCAqIFN1YnNjcmliZSB0byBkaXZlJ3MgZWRnZSBsaWZlY3ljbGUuIElkZW1wb3RlbnQ6IGF0dGFjaGluZyB0d2ljZSB3b3VsZFxuXHQgKiBkb3VibGUgZXZlcnkgZnJhbWUgcHVzaC4gRGl2ZSdzIGNsZWFyKCkgd2lwZXMgc3Vic2NyaWJlcnMg4oCUIHJlLWF0dGFjaFxuXHQgKiBhZnRlciBpdC5cblx0ICovXG5cdGF0dGFjaCAoKTogdm9pZCB7XG5cdFx0aWYgKHRoaXMuZGV0YWNoZXJzLmxlbmd0aCA+IDApIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMucHVzaChcblx0XHRcdHJlZ2lzdGVySG9vaygnZW50ZXInLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uRW50ZXIocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHJlZ2lzdGVySG9vaygnbGVhdmUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uTGVhdmUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHQpO1xuXHRcdHRyeSB7XG5cdFx0XHR0aGlzLmRldGFjaGVycy5wdXNoKFxuXHRcdFx0XHRyZWdpc3Rlckhvb2soJ2NyZWF0ZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdFx0dGhpcy5vbkNyZWF0ZShwYXlsb2FkKTtcblx0XHRcdFx0fSksXG5cdFx0XHQpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gJ2NyZWF0ZScgZXhpc3RzIHNpbmNlIGRpdmUgMC44LjA7IG9uIDAuNy54IHJlZ2lzdGVySG9vayB0aHJvd3Mg4oCUXG5cdFx0XHQvLyBza2lwcGluZyBwcmVzZXJ2ZXMgZXhhY3RseSB0aGUgcHJlLXN1YnNjcmlwdGlvbiBiZWhhdmlvci5cblx0XHR9XG5cdH1cblxuXHRkZXRhY2ggKCk6IHZvaWQge1xuXHRcdGZvciAoY29uc3QgZGV0YWNoIG9mIHRoaXMuZGV0YWNoZXJzKSB7XG5cdFx0XHRkZXRhY2goKTtcblx0XHR9XG5cdFx0dGhpcy5kZXRhY2hlcnMgPSBbXTtcblx0XHR0aGlzLmZyYW1lcy5jbGVhcigpO1xuXHR9XG5cblx0LyoqXG5cdCAqIEVzdGFibGlzaCBhIHJvb3QgZnJhbWUgZm9yIG5vbi1IVFRQIHNjb3BlcyAocXVldWUgY29uc3VtZXJzLCBDTEksXG5cdCAqIHRlc3RzKS4gVGhlIG1pZGRsZXdhcmUgaXMgdGhlIEhUVFAgcm9vdC5cblx0ICovXG5cdHJ1bkluU2NvcGU8VD4gKGZuOiAoKSA9PiBUKTogVCB7XG5cdFx0Y29uc3Qgcm9vdDogRmxvd0ZyYW1lID0ge1xuXHRcdFx0ZWRnZUlkIDogbnVsbCxcblx0XHRcdHBhcmVudCA6IG51bGwsXG5cdFx0XHRwaW5TZXQgOiBuZXcgU2V0PG9iamVjdD4oKSxcblx0XHR9O1xuXHRcdGNvbnN0IHJlc3VsdCA9IGFscy5ydW4ocm9vdCwgZm4pO1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHQvKipcblx0ICogVGhlIGZyYW1lIGFjdGl2ZSBSSUdIVCBOT1cg4oCUIGluIGFuIHVuY2F1Z2h0RXhjZXB0aW9uIGhhbmRsZXIgdGhpcyBpc1xuXHQgKiB0aGUgZmFpbGluZyBleGVjdXRpb24ncyBmcmFtZTogdGhlIHBhcmVudGFsIGVkZ2UgaWQgcGx1cyBldmVyeVxuXHQgKiBjb250ZXh0IGluc3RhbmNlIHBpbm5lZCBieSB0aGUgc2NvcGUuIFVuZGVmaW5lZCBvdXRzaWRlIGFueSBzY29wZS5cblx0ICovXG5cdGN1cnJlbnRGcmFtZSAoKTogQ3Jhc2hDb250ZXh0IHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBmcmFtZSA9IGFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghZnJhbWUpIHtcblx0XHRcdHJldHVybiB1bmRlZmluZWQ7XG5cdFx0fVxuXHRcdGNvbnN0IHJlc3VsdDogQ3Jhc2hDb250ZXh0ID0ge1xuXHRcdFx0ZWRnZUlkICAgIDogZnJhbWUuZWRnZUlkLFxuXHRcdFx0aW5zdGFuY2VzIDogWy4uLmZyYW1lLnBpblNldF0sXG5cdFx0fTtcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0cHJpdmF0ZSBvbkVudGVyICh7IGVkZ2UgfTogRGl2ZUVudGVyUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGN1cnJlbnQgPSBhbHMuZ2V0U3RvcmUoKTtcblx0XHRpZiAoIWN1cnJlbnQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgZnJhbWU6IEZsb3dGcmFtZSA9IHtcblx0XHRcdGVkZ2VJZCA6IGVkZ2UuaWQsXG5cdFx0XHRwYXJlbnQgOiBjdXJyZW50LFxuXHRcdFx0cGluU2V0IDogY3VycmVudC5waW5TZXQsXG5cdFx0fTtcblx0XHRpZiAoZWRnZS5pbnN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRmcmFtZS5waW5TZXQuYWRkKGVkZ2UuaW5zdGFuY2UpO1xuXHRcdH1cblx0XHR0aGlzLmZyYW1lcy5zZXQoZWRnZS5pZCwgZnJhbWUpO1xuXHRcdGFscy5lbnRlcldpdGgoZnJhbWUpO1xuXHR9XG5cblx0cHJpdmF0ZSBvbkxlYXZlICh7IGVkZ2UgfTogRGl2ZUxlYXZlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGZyYW1lID0gdGhpcy5mcmFtZXMuZ2V0KGVkZ2UuaWQpO1xuXHRcdGlmICghZnJhbWUpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0dGhpcy5mcmFtZXMuZGVsZXRlKGVkZ2UuaWQpO1xuXHRcdGlmIChmcmFtZS5wYXJlbnQpIHtcblx0XHRcdGFscy5lbnRlcldpdGgoZnJhbWUucGFyZW50KTtcblx0XHR9XG5cdH1cblxuXHRwcml2YXRlIG9uQ3JlYXRlICh7IGVkZ2UgfTogRGl2ZUNyZWF0ZVBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBjdXJyZW50ID0gYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFjdXJyZW50KSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdC8vIENvbnN0cnVjdGlvbnMgYXJlIG9uZS1zaG90IGVkZ2VzIChubyBsZWF2ZSkg4oCUIG5vIGZyYW1lIG9mIHRoZWlyXG5cdFx0Ly8gb3duLCBidXQgdGhlIGNvbnN0cnVjdGVkIGluc3RhbmNlIGlzIERBVEE6IHBpbiBpdCBpbnRvIHRoZSBzY29wZS5cblx0XHRpZiAoZWRnZS5pbnN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRjdXJyZW50LnBpblNldC5hZGQoZWRnZS5pbnN0YW5jZSk7XG5cdFx0fVxuXHR9XG59XG4iXX0=