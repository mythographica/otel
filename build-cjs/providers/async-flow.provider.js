"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncFlowProvider = void 0;
/**
 * Async-flow provider — the ALS backbone for dive attribution.
 *
 * Design: reports/async-flow-tracking-design.md.
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
const async_hooks_1 = require("async_hooks");
const dive_1 = require("@mnemonica/dive");
const als = new async_hooks_1.AsyncLocalStorage();
class AsyncFlowProvider {
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
        this.detachers.push((0, dive_1.registerHook)('enter', (payload) => {
            this.onEnter(payload);
        }), (0, dive_1.registerHook)('leave', (payload) => {
            this.onLeave(payload);
        }));
        try {
            this.detachers.push((0, dive_1.registerHook)('create', (payload) => {
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
exports.AsyncFlowProvider = AsyncFlowProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsNkNBQWdEO0FBQ2hELDBDQUErQztBQXVCL0MsTUFBTSxHQUFHLEdBQUcsSUFBSSwrQkFBaUIsRUFBYSxDQUFDO0FBRS9DLE1BQWEsaUJBQWlCO0lBQzdCLHdFQUF3RTtJQUNoRSxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQXFCLENBQUM7SUFDdEMsU0FBUyxHQUFzQixFQUFFLENBQUM7SUFFMUM7Ozs7T0FJRztJQUNILE1BQU07UUFDTCxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQ2xCLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDRixJQUFJLENBQUM7WUFDSixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBQSxtQkFBWSxFQUFDLFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO2dCQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDSCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1IsbUVBQW1FO1lBQ25FLDREQUE0RDtRQUM3RCxDQUFDO0lBQ0YsQ0FBQztJQUVELE1BQU07UUFDTCxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNyQyxNQUFNLEVBQUUsQ0FBQztRQUNWLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQztRQUNwQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVLENBQUssRUFBVztRQUN6QixNQUFNLElBQUksR0FBYztZQUN2QixNQUFNLEVBQUcsSUFBSTtZQUNiLE1BQU0sRUFBRyxJQUFJO1lBQ2IsTUFBTSxFQUFHLElBQUksR0FBRyxFQUFVO1NBQzFCLENBQUM7UUFDRixNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQyxPQUFPLE1BQU0sQ0FBQztJQUNmLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsWUFBWTtRQUNYLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3QixJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWixPQUFPLFNBQVMsQ0FBQztRQUNsQixDQUFDO1FBQ0QsTUFBTSxNQUFNLEdBQWlCO1lBQzVCLE1BQU0sRUFBTSxLQUFLLENBQUMsTUFBTTtZQUN4QixTQUFTLEVBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7U0FDN0IsQ0FBQztRQUNGLE9BQU8sTUFBTSxDQUFDO0lBQ2YsQ0FBQztJQUVPLE9BQU8sQ0FBRSxFQUFFLElBQUksRUFBb0I7UUFDMUMsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNkLE9BQU87UUFDUixDQUFDO1FBQ0QsTUFBTSxLQUFLLEdBQWM7WUFDeEIsTUFBTSxFQUFHLElBQUksQ0FBQyxFQUFFO1lBQ2hCLE1BQU0sRUFBRyxPQUFPO1lBQ2hCLE1BQU0sRUFBRyxPQUFPLENBQUMsTUFBTTtTQUN2QixDQUFDO1FBQ0YsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNqQyxDQUFDO1FBQ0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoQyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3RCLENBQUM7SUFFTyxPQUFPLENBQUUsRUFBRSxJQUFJLEVBQW9CO1FBQzFDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN2QyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWixPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1QixJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNsQixHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUM3QixDQUFDO0lBQ0YsQ0FBQztJQUVPLFFBQVEsQ0FBRSxFQUFFLElBQUksRUFBcUI7UUFDNUMsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNkLE9BQU87UUFDUixDQUFDO1FBQ0Qsa0VBQWtFO1FBQ2xFLG9FQUFvRTtRQUNwRSxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDakMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ25DLENBQUM7SUFDRixDQUFDO0NBQ0Q7QUFoSEQsOENBZ0hDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBc3luYy1mbG93IHByb3ZpZGVyIOKAlCB0aGUgQUxTIGJhY2tib25lIGZvciBkaXZlIGF0dHJpYnV0aW9uLlxuICpcbiAqIERlc2lnbjogcmVwb3J0cy9hc3luYy1mbG93LXRyYWNraW5nLWRlc2lnbi5tZC5cbiAqXG4gKiBPbmUgQXN5bmNMb2NhbFN0b3JhZ2UgY2FycnlpbmcgYSBsaW5rZWQgbGlzdCBvZiBGbG93RnJhbWVzLiBUaGUgcm9vdFxuICogZnJhbWUgaXMgY3JlYXRlZCBwZXIgSFRUUCByZXF1ZXN0IGJ5IE1uZW1vbmljYVRyYWNlTWlkZGxld2FyZSAob3JcbiAqIG1hbnVhbGx5IHZpYSBydW5JblNjb3BlKS4gRXZlcnkgZGl2ZSAnZW50ZXInIGhvb2sgcHVzaGVzIGEgY2hpbGQgZnJhbWVcbiAqIChlZGdlSWQgPSB0aGUgZW50ZXJpbmcgZWRnZSk7ICdsZWF2ZScgcmVzdG9yZXMgdGhlIHBhcmVudC4gQUxTXG4gKiBwcm9wYWdhdGlvbiB0aGVuIGRvZXMgdGhlIHRyYWNraW5nIGZvciBmcmVlOiBhbiBVTldSQVBQRUQgYXN5bmMgaG9wXG4gKiAoc2V0VGltZW91dCwgcHJvbWlzZSBjb250aW51YXRpb24sIGFzeW5jLWdlbmVyYXRvciBzdXNwZW5zaW9uKSBmaXJlc1xuICogd2l0aCB0aGUgc2NoZWR1bGluZyBmcmFtZSBpbiBhbHMuZ2V0U3RvcmUoKSDigJQgdGhlIHBhcmVudGFsIGRpdmUgZWRnZVxuICogaXMga25vd24gd2l0aG91dCB3cmFwcGluZyBhbnl0aGluZy5cbiAqXG4gKiBUaGUgc2NvcGVkIHBpbjogdGhlIHJvb3QgZnJhbWUgb3ducyBhIHBpblNldCBvZiBjb250ZXh0IGluc3RhbmNlc1xuICogKHN0cm9uZyByZWZzKSwgZmlsbGVkIG9uIGVudGVyL2NyZWF0ZSBmcm9tIGVkZ2UuaW5zdGFuY2UuIExpZmV0aW1lIGlzXG4gKiB0aGUgcmVxdWVzdCdzIGFzeW5jIGV4ZWN1dGlvbnMg4oCUIHdoZW4gdGhleSBkaWUsIHRoZSBzdG9yZSBhbmQgcGluU2V0XG4gKiBkaWUgd2l0aCB0aGVtLiBlZGdlLmluc3RhbmNlIG5ldmVyIGRlcmVmcyB0byB1bmRlZmluZWQgbWlkLXJlcXVlc3QuXG4gKlxuICogTm9kZS1vbmx5IGJ5IGRlc2lnbjogZGl2ZSBpbXBvcnRzIG5vIGFzeW5jX2hvb2tzIChEZW5vL0J1biksIHRoZVxuICogYWRhcHRlciBpcyB0aGUgTm9kZSBib3VuZGFyeSB3aGVyZSBBTFMgaXMgZnJlZS5cbiAqL1xuaW1wb3J0IHsgQXN5bmNMb2NhbFN0b3JhZ2UgfSBmcm9tICdhc3luY19ob29rcyc7XG5pbXBvcnQgeyByZWdpc3Rlckhvb2sgfSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuaW1wb3J0IHR5cGUge1xuXHREaXZlQ3JlYXRlUGF5bG9hZCxcblx0RGl2ZUVudGVyUGF5bG9hZCxcblx0RGl2ZUxlYXZlUGF5bG9hZCxcbn0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcblxuZXhwb3J0IHR5cGUgRmxvd0ZyYW1lID0ge1xuXHQvKiogdGhlIGRpdmUgZWRnZSB0aGlzIGZyYW1lIGJlbG9uZ3MgdG8gKG51bGwgb24gdGhlIHJvb3QgZnJhbWUpICovXG5cdGVkZ2VJZCAgIDogbnVtYmVyIHwgbnVsbDtcblx0LyoqIHRoZSBmcmFtZSBhY3RpdmUgd2hlbiB0aGlzIG9uZSB3YXMgZW50ZXJlZCAqL1xuXHRwYXJlbnQgICA6IEZsb3dGcmFtZSB8IG51bGw7XG5cdC8qKiBzdHJvbmcgcGlucyBvZiBjb250ZXh0IGluc3RhbmNlcyDigJQgT05FIHNldCBwZXIgc2NvcGUsIHNoYXJlZCBkb3duXG5cdCAqICB0aGUgY2hhaW4gYnkgcmVmZXJlbmNlOyBkaWVzIHdpdGggdGhlIHNjb3BlJ3MgYXN5bmMgZXhlY3V0aW9ucyAqL1xuXHRwaW5TZXQgICA6IFNldDxvYmplY3Q+O1xufTtcblxuLyoqIFJlYWQtb25seSBjcmFzaC10aW1lIHZpZXcgb2YgdGhlIGFjdGl2ZSBmcmFtZS4gKi9cbmV4cG9ydCB0eXBlIENyYXNoQ29udGV4dCA9IHtcblx0ZWRnZUlkICAgIDogbnVtYmVyIHwgbnVsbDtcblx0aW5zdGFuY2VzIDogb2JqZWN0W107XG59O1xuXG5jb25zdCBhbHMgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2U8Rmxvd0ZyYW1lPigpO1xuXG5leHBvcnQgY2xhc3MgQXN5bmNGbG93UHJvdmlkZXIge1xuXHQvLyBlZGdlSWQg4oaSIHRoZSBmcmFtZSBlbnRlcmVkIGZvciBpdCwgc28gbGVhdmUgcmVzdG9yZXMgdGhlIGV4YWN0IHBhcmVudFxuXHRwcml2YXRlIGZyYW1lcyA9IG5ldyBNYXA8bnVtYmVyLCBGbG93RnJhbWU+KCk7XG5cdHByaXZhdGUgZGV0YWNoZXJzOiBBcnJheTwoKSA9PiB2b2lkPiA9IFtdO1xuXG5cdC8qKlxuXHQgKiBTdWJzY3JpYmUgdG8gZGl2ZSdzIGVkZ2UgbGlmZWN5Y2xlLiBJZGVtcG90ZW50OiBhdHRhY2hpbmcgdHdpY2Ugd291bGRcblx0ICogZG91YmxlIGV2ZXJ5IGZyYW1lIHB1c2guIERpdmUncyBjbGVhcigpIHdpcGVzIHN1YnNjcmliZXJzIOKAlCByZS1hdHRhY2hcblx0ICogYWZ0ZXIgaXQuXG5cdCAqL1xuXHRhdHRhY2ggKCk6IHZvaWQge1xuXHRcdGlmICh0aGlzLmRldGFjaGVycy5sZW5ndGggPiAwKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHRyZWdpc3Rlckhvb2soJ2VudGVyJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkVudGVyKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0XHRyZWdpc3Rlckhvb2soJ2xlYXZlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0dGhpcy5vbkxlYXZlKHBheWxvYWQpO1xuXHRcdFx0fSksXG5cdFx0KTtcblx0XHR0cnkge1xuXHRcdFx0dGhpcy5kZXRhY2hlcnMucHVzaChcblx0XHRcdFx0cmVnaXN0ZXJIb29rKCdjcmVhdGUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHRcdHRoaXMub25DcmVhdGUocGF5bG9hZCk7XG5cdFx0XHRcdH0pLFxuXHRcdFx0KTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vICdjcmVhdGUnIGV4aXN0cyBzaW5jZSBkaXZlIDAuOC4wOyBvbiAwLjcueCByZWdpc3Rlckhvb2sgdGhyb3dzIOKAlFxuXHRcdFx0Ly8gc2tpcHBpbmcgcHJlc2VydmVzIGV4YWN0bHkgdGhlIHByZS1zdWJzY3JpcHRpb24gYmVoYXZpb3IuXG5cdFx0fVxuXHR9XG5cblx0ZGV0YWNoICgpOiB2b2lkIHtcblx0XHRmb3IgKGNvbnN0IGRldGFjaCBvZiB0aGlzLmRldGFjaGVycykge1xuXHRcdFx0ZGV0YWNoKCk7XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzID0gW107XG5cdFx0dGhpcy5mcmFtZXMuY2xlYXIoKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBFc3RhYmxpc2ggYSByb290IGZyYW1lIGZvciBub24tSFRUUCBzY29wZXMgKHF1ZXVlIGNvbnN1bWVycywgQ0xJLFxuXHQgKiB0ZXN0cykuIFRoZSBtaWRkbGV3YXJlIGlzIHRoZSBIVFRQIHJvb3QuXG5cdCAqL1xuXHRydW5JblNjb3BlPFQ+IChmbjogKCkgPT4gVCk6IFQge1xuXHRcdGNvbnN0IHJvb3Q6IEZsb3dGcmFtZSA9IHtcblx0XHRcdGVkZ2VJZCA6IG51bGwsXG5cdFx0XHRwYXJlbnQgOiBudWxsLFxuXHRcdFx0cGluU2V0IDogbmV3IFNldDxvYmplY3Q+KCksXG5cdFx0fTtcblx0XHRjb25zdCByZXN1bHQgPSBhbHMucnVuKHJvb3QsIGZuKTtcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0LyoqXG5cdCAqIFRoZSBmcmFtZSBhY3RpdmUgUklHSFQgTk9XIOKAlCBpbiBhbiB1bmNhdWdodEV4Y2VwdGlvbiBoYW5kbGVyIHRoaXMgaXNcblx0ICogdGhlIGZhaWxpbmcgZXhlY3V0aW9uJ3MgZnJhbWU6IHRoZSBwYXJlbnRhbCBlZGdlIGlkIHBsdXMgZXZlcnlcblx0ICogY29udGV4dCBpbnN0YW5jZSBwaW5uZWQgYnkgdGhlIHNjb3BlLiBVbmRlZmluZWQgb3V0c2lkZSBhbnkgc2NvcGUuXG5cdCAqL1xuXHRjdXJyZW50RnJhbWUgKCk6IENyYXNoQ29udGV4dCB8IHVuZGVmaW5lZCB7XG5cdFx0Y29uc3QgZnJhbWUgPSBhbHMuZ2V0U3RvcmUoKTtcblx0XHRpZiAoIWZyYW1lKSB7XG5cdFx0XHRyZXR1cm4gdW5kZWZpbmVkO1xuXHRcdH1cblx0XHRjb25zdCByZXN1bHQ6IENyYXNoQ29udGV4dCA9IHtcblx0XHRcdGVkZ2VJZCAgICA6IGZyYW1lLmVkZ2VJZCxcblx0XHRcdGluc3RhbmNlcyA6IFsuLi5mcmFtZS5waW5TZXRdLFxuXHRcdH07XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdHByaXZhdGUgb25FbnRlciAoeyBlZGdlIH06IERpdmVFbnRlclBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBjdXJyZW50ID0gYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFjdXJyZW50KSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IGZyYW1lOiBGbG93RnJhbWUgPSB7XG5cdFx0XHRlZGdlSWQgOiBlZGdlLmlkLFxuXHRcdFx0cGFyZW50IDogY3VycmVudCxcblx0XHRcdHBpblNldCA6IGN1cnJlbnQucGluU2V0LFxuXHRcdH07XG5cdFx0aWYgKGVkZ2UuaW5zdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0ZnJhbWUucGluU2V0LmFkZChlZGdlLmluc3RhbmNlKTtcblx0XHR9XG5cdFx0dGhpcy5mcmFtZXMuc2V0KGVkZ2UuaWQsIGZyYW1lKTtcblx0XHRhbHMuZW50ZXJXaXRoKGZyYW1lKTtcblx0fVxuXG5cdHByaXZhdGUgb25MZWF2ZSAoeyBlZGdlIH06IERpdmVMZWF2ZVBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBmcmFtZSA9IHRoaXMuZnJhbWVzLmdldChlZGdlLmlkKTtcblx0XHRpZiAoIWZyYW1lKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZnJhbWVzLmRlbGV0ZShlZGdlLmlkKTtcblx0XHRpZiAoZnJhbWUucGFyZW50KSB7XG5cdFx0XHRhbHMuZW50ZXJXaXRoKGZyYW1lLnBhcmVudCk7XG5cdFx0fVxuXHR9XG5cblx0cHJpdmF0ZSBvbkNyZWF0ZSAoeyBlZGdlIH06IERpdmVDcmVhdGVQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgY3VycmVudCA9IGFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghY3VycmVudCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHQvLyBDb25zdHJ1Y3Rpb25zIGFyZSBvbmUtc2hvdCBlZGdlcyAobm8gbGVhdmUpIOKAlCBubyBmcmFtZSBvZiB0aGVpclxuXHRcdC8vIG93biwgYnV0IHRoZSBjb25zdHJ1Y3RlZCBpbnN0YW5jZSBpcyBEQVRBOiBwaW4gaXQgaW50byB0aGUgc2NvcGUuXG5cdFx0aWYgKGVkZ2UuaW5zdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Y3VycmVudC5waW5TZXQuYWRkKGVkZ2UuaW5zdGFuY2UpO1xuXHRcdH1cblx0fVxufVxuIl19