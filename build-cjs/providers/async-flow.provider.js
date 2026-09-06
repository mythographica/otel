"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncFlowProvider = void 0;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsNkNBQWdEO0FBQ2hELDBDQUErQztBQXVCL0MsTUFBTSxHQUFHLEdBQUcsSUFBSSwrQkFBaUIsRUFBYSxDQUFDO0FBRS9DLE1BQWEsaUJBQWlCO0lBQzdCLHdFQUF3RTtJQUNoRSxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQXFCLENBQUM7SUFDdEMsU0FBUyxHQUFzQixFQUFFLENBQUM7SUFFMUM7Ozs7T0FJRztJQUNILE1BQU07UUFDTCxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQ2xCLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDRixJQUFJLENBQUM7WUFDSixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBQSxtQkFBWSxFQUFDLFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO2dCQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDSCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1IsbUVBQW1FO1lB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Q0Q7QUFoSEQsOENBZ0hDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBc3luYy1mbG93IHByb3ZpZGVyIOKAlCB0aGUgQUxTIGJhY2tib25lIGZvciBkaXZlIGF0dHJpYnV0aW9uLlxuICpcbiAqIERlc2lnbjogcmVwb3J0cy9hc3luYy1mbG93LXRyYWNraW5nLWRlc2lnbi5tZCAoMjAyNi0wOS0wMikuXG4gKlxuICogT25lIEFzeW5jTG9jYWxTdG9yYWdlIGNhcnJ5aW5nIGEgbGlua2VkIGxpc3Qgb2YgRmxvd0ZyYW1lcy4gVGhlIHJvb3RcbiAqIGZyYW1lIGlzIGNyZWF0ZWQgcGVyIEhUVFAgcmVxdWVzdCBieSBNbmVtb25pY2FUcmFjZU1pZGRsZXdhcmUgKG9yXG4gKiBtYW51YWxseSB2aWEgcnVuSW5TY29wZSkuIEV2ZXJ5IGRpdmUgJ2VudGVyJyBob29rIHB1c2hlcyBhIGNoaWxkIGZyYW1lXG4gKiAoZWRnZUlkID0gdGhlIGVudGVyaW5nIGVkZ2UpOyAnbGVhdmUnIHJlc3RvcmVzIHRoZSBwYXJlbnQuIEFMU1xuICogcHJvcGFnYXRpb24gdGhlbiBkb2VzIHRoZSB0cmFja2luZyBmb3IgZnJlZTogYW4gVU5XUkFQUEVEIGFzeW5jIGhvcFxuICogKHNldFRpbWVvdXQsIHByb21pc2UgY29udGludWF0aW9uLCBhc3luYy1nZW5lcmF0b3Igc3VzcGVuc2lvbikgZmlyZXNcbiAqIHdpdGggdGhlIHNjaGVkdWxpbmcgZnJhbWUgaW4gYWxzLmdldFN0b3JlKCkg4oCUIHRoZSBwYXJlbnRhbCBkaXZlIGVkZ2VcbiAqIGlzIGtub3duIHdpdGhvdXQgd3JhcHBpbmcgYW55dGhpbmcuXG4gKlxuICogVGhlIHNjb3BlZCBwaW46IHRoZSByb290IGZyYW1lIG93bnMgYSBwaW5TZXQgb2YgY29udGV4dCBpbnN0YW5jZXNcbiAqIChzdHJvbmcgcmVmcyksIGZpbGxlZCBvbiBlbnRlci9jcmVhdGUgZnJvbSBlZGdlLmluc3RhbmNlLiBMaWZldGltZSBpc1xuICogdGhlIHJlcXVlc3QncyBhc3luYyBleGVjdXRpb25zIOKAlCB3aGVuIHRoZXkgZGllLCB0aGUgc3RvcmUgYW5kIHBpblNldFxuICogZGllIHdpdGggdGhlbS4gZWRnZS5pbnN0YW5jZSBuZXZlciBkZXJlZnMgdG8gdW5kZWZpbmVkIG1pZC1yZXF1ZXN0LlxuICpcbiAqIE5vZGUtb25seSBieSBkZXNpZ246IGRpdmUgaW1wb3J0cyBubyBhc3luY19ob29rcyAoRGVuby9CdW4pLCB0aGVcbiAqIGFkYXB0ZXIgaXMgdGhlIE5vZGUgYm91bmRhcnkgd2hlcmUgQUxTIGlzIGZyZWUuXG4gKi9cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnYXN5bmNfaG9va3MnO1xuaW1wb3J0IHsgcmVnaXN0ZXJIb29rIH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB0eXBlIHtcblx0RGl2ZUNyZWF0ZVBheWxvYWQsXG5cdERpdmVFbnRlclBheWxvYWQsXG5cdERpdmVMZWF2ZVBheWxvYWQsXG59IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5cbmV4cG9ydCB0eXBlIEZsb3dGcmFtZSA9IHtcblx0LyoqIHRoZSBkaXZlIGVkZ2UgdGhpcyBmcmFtZSBiZWxvbmdzIHRvIChudWxsIG9uIHRoZSByb290IGZyYW1lKSAqL1xuXHRlZGdlSWQgICA6IG51bWJlciB8IG51bGw7XG5cdC8qKiB0aGUgZnJhbWUgYWN0aXZlIHdoZW4gdGhpcyBvbmUgd2FzIGVudGVyZWQgKi9cblx0cGFyZW50ICAgOiBGbG93RnJhbWUgfCBudWxsO1xuXHQvKiogc3Ryb25nIHBpbnMgb2YgY29udGV4dCBpbnN0YW5jZXMg4oCUIE9ORSBzZXQgcGVyIHNjb3BlLCBzaGFyZWQgZG93blxuXHQgKiAgdGhlIGNoYWluIGJ5IHJlZmVyZW5jZTsgZGllcyB3aXRoIHRoZSBzY29wZSdzIGFzeW5jIGV4ZWN1dGlvbnMgKi9cblx0cGluU2V0ICAgOiBTZXQ8b2JqZWN0Pjtcbn07XG5cbi8qKiBSZWFkLW9ubHkgY3Jhc2gtdGltZSB2aWV3IG9mIHRoZSBhY3RpdmUgZnJhbWUuICovXG5leHBvcnQgdHlwZSBDcmFzaENvbnRleHQgPSB7XG5cdGVkZ2VJZCAgICA6IG51bWJlciB8IG51bGw7XG5cdGluc3RhbmNlcyA6IG9iamVjdFtdO1xufTtcblxuY29uc3QgYWxzID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPEZsb3dGcmFtZT4oKTtcblxuZXhwb3J0IGNsYXNzIEFzeW5jRmxvd1Byb3ZpZGVyIHtcblx0Ly8gZWRnZUlkIOKGkiB0aGUgZnJhbWUgZW50ZXJlZCBmb3IgaXQsIHNvIGxlYXZlIHJlc3RvcmVzIHRoZSBleGFjdCBwYXJlbnRcblx0cHJpdmF0ZSBmcmFtZXMgPSBuZXcgTWFwPG51bWJlciwgRmxvd0ZyYW1lPigpO1xuXHRwcml2YXRlIGRldGFjaGVyczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuXHQvKipcblx0ICogU3Vic2NyaWJlIHRvIGRpdmUncyBlZGdlIGxpZmVjeWNsZS4gSWRlbXBvdGVudDogYXR0YWNoaW5nIHR3aWNlIHdvdWxkXG5cdCAqIGRvdWJsZSBldmVyeSBmcmFtZSBwdXNoLiBEaXZlJ3MgY2xlYXIoKSB3aXBlcyBzdWJzY3JpYmVycyDigJQgcmUtYXR0YWNoXG5cdCAqIGFmdGVyIGl0LlxuXHQgKi9cblx0YXR0YWNoICgpOiB2b2lkIHtcblx0XHRpZiAodGhpcy5kZXRhY2hlcnMubGVuZ3RoID4gMCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycy5wdXNoKFxuXHRcdFx0cmVnaXN0ZXJIb29rKCdlbnRlcicsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25FbnRlcihwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0cmVnaXN0ZXJIb29rKCdsZWF2ZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25MZWF2ZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdCk7XG5cdFx0dHJ5IHtcblx0XHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHRcdHJlZ2lzdGVySG9vaygnY3JlYXRlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0XHR0aGlzLm9uQ3JlYXRlKHBheWxvYWQpO1xuXHRcdFx0XHR9KSxcblx0XHRcdCk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyAnY3JlYXRlJyBleGlzdHMgc2luY2UgZGl2ZSAwLjguMDsgb24gMC43LnggcmVnaXN0ZXJIb29rIHRocm93cyDigJRcblx0XHRcdC8vIHNraXBwaW5nIHByZXNlcnZlcyBleGFjdGx5IHRoZSBwcmUtc3Vic2NyaXB0aW9uIGJlaGF2aW9yLlxuXHRcdH1cblx0fVxuXG5cdGRldGFjaCAoKTogdm9pZCB7XG5cdFx0Zm9yIChjb25zdCBkZXRhY2ggb2YgdGhpcy5kZXRhY2hlcnMpIHtcblx0XHRcdGRldGFjaCgpO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycyA9IFtdO1xuXHRcdHRoaXMuZnJhbWVzLmNsZWFyKCk7XG5cdH1cblxuXHQvKipcblx0ICogRXN0YWJsaXNoIGEgcm9vdCBmcmFtZSBmb3Igbm9uLUhUVFAgc2NvcGVzIChxdWV1ZSBjb25zdW1lcnMsIENMSSxcblx0ICogdGVzdHMpLiBUaGUgbWlkZGxld2FyZSBpcyB0aGUgSFRUUCByb290LlxuXHQgKi9cblx0cnVuSW5TY29wZTxUPiAoZm46ICgpID0+IFQpOiBUIHtcblx0XHRjb25zdCByb290OiBGbG93RnJhbWUgPSB7XG5cdFx0XHRlZGdlSWQgOiBudWxsLFxuXHRcdFx0cGFyZW50IDogbnVsbCxcblx0XHRcdHBpblNldCA6IG5ldyBTZXQ8b2JqZWN0PigpLFxuXHRcdH07XG5cdFx0Y29uc3QgcmVzdWx0ID0gYWxzLnJ1bihyb290LCBmbik7XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdC8qKlxuXHQgKiBUaGUgZnJhbWUgYWN0aXZlIFJJR0hUIE5PVyDigJQgaW4gYW4gdW5jYXVnaHRFeGNlcHRpb24gaGFuZGxlciB0aGlzIGlzXG5cdCAqIHRoZSBmYWlsaW5nIGV4ZWN1dGlvbidzIGZyYW1lOiB0aGUgcGFyZW50YWwgZWRnZSBpZCBwbHVzIGV2ZXJ5XG5cdCAqIGNvbnRleHQgaW5zdGFuY2UgcGlubmVkIGJ5IHRoZSBzY29wZS4gVW5kZWZpbmVkIG91dHNpZGUgYW55IHNjb3BlLlxuXHQgKi9cblx0Y3VycmVudEZyYW1lICgpOiBDcmFzaENvbnRleHQgfCB1bmRlZmluZWQge1xuXHRcdGNvbnN0IGZyYW1lID0gYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuIHVuZGVmaW5lZDtcblx0XHR9XG5cdFx0Y29uc3QgcmVzdWx0OiBDcmFzaENvbnRleHQgPSB7XG5cdFx0XHRlZGdlSWQgICAgOiBmcmFtZS5lZGdlSWQsXG5cdFx0XHRpbnN0YW5jZXMgOiBbLi4uZnJhbWUucGluU2V0XSxcblx0XHR9O1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHRwcml2YXRlIG9uRW50ZXIgKHsgZWRnZSB9OiBEaXZlRW50ZXJQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgY3VycmVudCA9IGFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghY3VycmVudCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRjb25zdCBmcmFtZTogRmxvd0ZyYW1lID0ge1xuXHRcdFx0ZWRnZUlkIDogZWRnZS5pZCxcblx0XHRcdHBhcmVudCA6IGN1cnJlbnQsXG5cdFx0XHRwaW5TZXQgOiBjdXJyZW50LnBpblNldCxcblx0XHR9O1xuXHRcdGlmIChlZGdlLmluc3RhbmNlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdGZyYW1lLnBpblNldC5hZGQoZWRnZS5pbnN0YW5jZSk7XG5cdFx0fVxuXHRcdHRoaXMuZnJhbWVzLnNldChlZGdlLmlkLCBmcmFtZSk7XG5cdFx0YWxzLmVudGVyV2l0aChmcmFtZSk7XG5cdH1cblxuXHRwcml2YXRlIG9uTGVhdmUgKHsgZWRnZSB9OiBEaXZlTGVhdmVQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgZnJhbWUgPSB0aGlzLmZyYW1lcy5nZXQoZWRnZS5pZCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmZyYW1lcy5kZWxldGUoZWRnZS5pZCk7XG5cdFx0aWYgKGZyYW1lLnBhcmVudCkge1xuXHRcdFx0YWxzLmVudGVyV2l0aChmcmFtZS5wYXJlbnQpO1xuXHRcdH1cblx0fVxuXG5cdHByaXZhdGUgb25DcmVhdGUgKHsgZWRnZSB9OiBEaXZlQ3JlYXRlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGN1cnJlbnQgPSBhbHMuZ2V0U3RvcmUoKTtcblx0XHRpZiAoIWN1cnJlbnQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Ly8gQ29uc3RydWN0aW9ucyBhcmUgb25lLXNob3QgZWRnZXMgKG5vIGxlYXZlKSDigJQgbm8gZnJhbWUgb2YgdGhlaXJcblx0XHQvLyBvd24sIGJ1dCB0aGUgY29uc3RydWN0ZWQgaW5zdGFuY2UgaXMgREFUQTogcGluIGl0IGludG8gdGhlIHNjb3BlLlxuXHRcdGlmIChlZGdlLmluc3RhbmNlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdGN1cnJlbnQucGluU2V0LmFkZChlZGdlLmluc3RhbmNlKTtcblx0XHR9XG5cdH1cbn1cbiJdfQ==