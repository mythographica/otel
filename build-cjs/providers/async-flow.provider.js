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
        if (frame.edge !== undefined) {
            result.edge = frame.edge;
        }
        return result;
    }
    onEnter({ edge }) {
        const current = als.getStore();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsNkNBQWdEO0FBQ2hELDBDQUErQztBQW1DL0MsTUFBTSxHQUFHLEdBQUcsSUFBSSwrQkFBaUIsRUFBYSxDQUFDO0FBRS9DLE1BQWEsaUJBQWlCO0lBQzdCLHdFQUF3RTtJQUNoRSxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQXFCLENBQUM7SUFDdEMsU0FBUyxHQUFzQixFQUFFLENBQUM7SUFFMUM7Ozs7T0FJRztJQUNILE1BQU07UUFDTCxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQ2xCLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUEsbUJBQVksRUFBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDRixJQUFJLENBQUM7WUFDSixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBQSxtQkFBWSxFQUFDLFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxFQUFFO2dCQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUNGLENBQUM7UUFDSCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1IsbUVBQW1FO1lB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QUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLE9BQU8sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNuQyxDQUFDO0lBQ0YsQ0FBQztDQUNEO0FBcEhELDhDQW9IQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQXN5bmMtZmxvdyBwcm92aWRlciDigJQgdGhlIEFMUyBiYWNrYm9uZSBmb3IgZGl2ZSBhdHRyaWJ1dGlvbi5cbiAqXG4gKiBEZXNpZ246IHJlcG9ydHMvYXN5bmMtZmxvdy10cmFja2luZy1kZXNpZ24ubWQuXG4gKlxuICogT25lIEFzeW5jTG9jYWxTdG9yYWdlIGNhcnJ5aW5nIGEgbGlua2VkIGxpc3Qgb2YgRmxvd0ZyYW1lcy4gVGhlIHJvb3RcbiAqIGZyYW1lIGlzIGNyZWF0ZWQgcGVyIEhUVFAgcmVxdWVzdCBieSBNbmVtb25pY2FUcmFjZU1pZGRsZXdhcmUgKG9yXG4gKiBtYW51YWxseSB2aWEgcnVuSW5TY29wZSkuIEV2ZXJ5IGRpdmUgJ2VudGVyJyBob29rIHB1c2hlcyBhIGNoaWxkIGZyYW1lXG4gKiAoZWRnZUlkID0gdGhlIGVudGVyaW5nIGVkZ2UpOyAnbGVhdmUnIHJlc3RvcmVzIHRoZSBwYXJlbnQuIEFMU1xuICogcHJvcGFnYXRpb24gdGhlbiBkb2VzIHRoZSB0cmFja2luZyBmb3IgZnJlZTogYW4gVU5XUkFQUEVEIGFzeW5jIGhvcFxuICogKHNldFRpbWVvdXQsIHByb21pc2UgY29udGludWF0aW9uLCBhc3luYy1nZW5lcmF0b3Igc3VzcGVuc2lvbikgZmlyZXNcbiAqIHdpdGggdGhlIHNjaGVkdWxpbmcgZnJhbWUgaW4gYWxzLmdldFN0b3JlKCkg4oCUIHRoZSBwYXJlbnRhbCBkaXZlIGVkZ2VcbiAqIGlzIGtub3duIHdpdGhvdXQgd3JhcHBpbmcgYW55dGhpbmcuXG4gKlxuICogVGhlIHNjb3BlZCBwaW46IHRoZSByb290IGZyYW1lIG93bnMgYSBwaW5TZXQgb2YgY29udGV4dCBpbnN0YW5jZXNcbiAqIChzdHJvbmcgcmVmcyksIGZpbGxlZCBvbiBlbnRlci9jcmVhdGUgZnJvbSBlZGdlLmluc3RhbmNlLiBMaWZldGltZSBpc1xuICogdGhlIHJlcXVlc3QncyBhc3luYyBleGVjdXRpb25zIOKAlCB3aGVuIHRoZXkgZGllLCB0aGUgc3RvcmUgYW5kIHBpblNldFxuICogZGllIHdpdGggdGhlbS4gZWRnZS5pbnN0YW5jZSBuZXZlciBkZXJlZnMgdG8gdW5kZWZpbmVkIG1pZC1yZXF1ZXN0LlxuICpcbiAqIE5vZGUtb25seSBieSBkZXNpZ246IGRpdmUgaW1wb3J0cyBubyBhc3luY19ob29rcyAoRGVuby9CdW4pLCB0aGVcbiAqIGFkYXB0ZXIgaXMgdGhlIE5vZGUgYm91bmRhcnkgd2hlcmUgQUxTIGlzIGZyZWUuXG4gKi9cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnYXN5bmNfaG9va3MnO1xuaW1wb3J0IHsgcmVnaXN0ZXJIb29rIH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB0eXBlIHtcblx0RGl2ZUNyZWF0ZVBheWxvYWQsXG5cdERpdmVFbnRlclBheWxvYWQsXG5cdERpdmVMZWF2ZVBheWxvYWQsXG5cdEZsb3dFZGdlLFxufSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuXG5leHBvcnQgdHlwZSBGbG93RnJhbWUgPSB7XG5cdC8qKiB0aGUgZGl2ZSBlZGdlIHRoaXMgZnJhbWUgYmVsb25ncyB0byAobnVsbCBvbiB0aGUgcm9vdCBmcmFtZSkgKi9cblx0ZWRnZUlkICAgOiBudW1iZXIgfCBudWxsO1xuXHQvKipcblx0ICogdGhlIGVkZ2Ugb2JqZWN0IGZyb20gdGhlIGVudGVyIHBheWxvYWQg4oCUIGRpdmUgaGFuZHMgdGhlIExJVkUgZWRnZSwgc29cblx0ICogdGhlIGZyYW1lIGtlZXBzIGl0IChhbmQsIHRocm91Z2ggZGl2ZSdzIHBhcmVudCBsaW5rcywgaXRzIGFuY2VzdG9ycylcblx0ICogYWxpdmUgYXMgbG9uZyBhcyB0aGUgc2NvcGUncyBhc3luYyB3b3JrIGxpdmVzLiBUaGF0IHJldGVudGlvbiBpcyB3aGF0XG5cdCAqIG1ha2VzIGNyYXNoLXRpbWUgZnJhbWUgYXR0cmlidXRpb24gZXZpZGVuY2UsIHRoZSBzYW1lIHdheSBhIHBlbmRpbmdcblx0ICogdGltZXIga2VlcHMgaXRzIGJyYW5jaC5cblx0ICovXG5cdGVkZ2U/ICAgIDogRmxvd0VkZ2U7XG5cdC8qKiB0aGUgZnJhbWUgYWN0aXZlIHdoZW4gdGhpcyBvbmUgd2FzIGVudGVyZWQgKi9cblx0cGFyZW50ICAgOiBGbG93RnJhbWUgfCBudWxsO1xuXHQvKiogc3Ryb25nIHBpbnMgb2YgY29udGV4dCBpbnN0YW5jZXMg4oCUIE9ORSBzZXQgcGVyIHNjb3BlLCBzaGFyZWQgZG93blxuXHQgKiAgdGhlIGNoYWluIGJ5IHJlZmVyZW5jZTsgZGllcyB3aXRoIHRoZSBzY29wZSdzIGFzeW5jIGV4ZWN1dGlvbnMgKi9cblx0cGluU2V0ICAgOiBTZXQ8b2JqZWN0Pjtcbn07XG5cbi8qKiBSZWFkLW9ubHkgY3Jhc2gtdGltZSB2aWV3IG9mIHRoZSBhY3RpdmUgZnJhbWUuICovXG5leHBvcnQgdHlwZSBDcmFzaENvbnRleHQgPSB7XG5cdGVkZ2VJZCAgICA6IG51bWJlciB8IG51bGw7XG5cdC8qKiB0aGUgZW50ZXJpbmcgZWRnZSAodGhlIExJVkUgZWRnZSDigJQgc3Ryb25nbHkgaGVsZCBieSB0aGUgZnJhbWUsIHNvXG5cdCAqICBhbGl2ZSB3aGVuZXZlciB0aGUgZnJhbWUgaXMpLCB3aGVuIHRoZSBmcmFtZSBiZWxvbmdzIHRvIGFuIGVkZ2UgKi9cblx0ZWRnZT8gICAgIDogRmxvd0VkZ2U7XG5cdGluc3RhbmNlcyA6IG9iamVjdFtdO1xufTtcblxuY29uc3QgYWxzID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPEZsb3dGcmFtZT4oKTtcblxuZXhwb3J0IGNsYXNzIEFzeW5jRmxvd1Byb3ZpZGVyIHtcblx0Ly8gZWRnZUlkIOKGkiB0aGUgZnJhbWUgZW50ZXJlZCBmb3IgaXQsIHNvIGxlYXZlIHJlc3RvcmVzIHRoZSBleGFjdCBwYXJlbnRcblx0cHJpdmF0ZSBmcmFtZXMgPSBuZXcgTWFwPG51bWJlciwgRmxvd0ZyYW1lPigpO1xuXHRwcml2YXRlIGRldGFjaGVyczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuXHQvKipcblx0ICogU3Vic2NyaWJlIHRvIGRpdmUncyBlZGdlIGxpZmVjeWNsZS4gSWRlbXBvdGVudDogYXR0YWNoaW5nIHR3aWNlIHdvdWxkXG5cdCAqIGRvdWJsZSBldmVyeSBmcmFtZSBwdXNoLiBEaXZlJ3MgY2xlYXIoKSB3aXBlcyBzdWJzY3JpYmVycyDigJQgcmUtYXR0YWNoXG5cdCAqIGFmdGVyIGl0LlxuXHQgKi9cblx0YXR0YWNoICgpOiB2b2lkIHtcblx0XHRpZiAodGhpcy5kZXRhY2hlcnMubGVuZ3RoID4gMCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycy5wdXNoKFxuXHRcdFx0cmVnaXN0ZXJIb29rKCdlbnRlcicsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25FbnRlcihwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0cmVnaXN0ZXJIb29rKCdsZWF2ZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25MZWF2ZShwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdCk7XG5cdFx0dHJ5IHtcblx0XHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHRcdHJlZ2lzdGVySG9vaygnY3JlYXRlJywgKHBheWxvYWQpID0+IHtcblx0XHRcdFx0XHR0aGlzLm9uQ3JlYXRlKHBheWxvYWQpO1xuXHRcdFx0XHR9KSxcblx0XHRcdCk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyAnY3JlYXRlJyBleGlzdHMgc2luY2UgZGl2ZSAwLjguMDsgb24gMC43LnggcmVnaXN0ZXJIb29rIHRocm93cyDigJRcblx0XHRcdC8vIHNraXBwaW5nIHByZXNlcnZlcyBleGFjdGx5IHRoZSBwcmUtc3Vic2NyaXB0aW9uIGJlaGF2aW9yLlxuXHRcdH1cblx0fVxuXG5cdGRldGFjaCAoKTogdm9pZCB7XG5cdFx0Zm9yIChjb25zdCBkZXRhY2ggb2YgdGhpcy5kZXRhY2hlcnMpIHtcblx0XHRcdGRldGFjaCgpO1xuXHRcdH1cblx0XHR0aGlzLmRldGFjaGVycyA9IFtdO1xuXHRcdHRoaXMuZnJhbWVzLmNsZWFyKCk7XG5cdH1cblxuXHQvKipcblx0ICogRXN0YWJsaXNoIGEgcm9vdCBmcmFtZSBmb3Igbm9uLUhUVFAgc2NvcGVzIChxdWV1ZSBjb25zdW1lcnMsIENMSSxcblx0ICogdGVzdHMpLiBUaGUgbWlkZGxld2FyZSBpcyB0aGUgSFRUUCByb290LlxuXHQgKi9cblx0cnVuSW5TY29wZTxUPiAoZm46ICgpID0+IFQpOiBUIHtcblx0XHRjb25zdCByb290OiBGbG93RnJhbWUgPSB7XG5cdFx0XHRlZGdlSWQgOiBudWxsLFxuXHRcdFx0cGFyZW50IDogbnVsbCxcblx0XHRcdHBpblNldCA6IG5ldyBTZXQ8b2JqZWN0PigpLFxuXHRcdH07XG5cdFx0Y29uc3QgcmVzdWx0ID0gYWxzLnJ1bihyb290LCBmbik7XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdC8qKlxuXHQgKiBUaGUgZnJhbWUgYWN0aXZlIFJJR0hUIE5PVyDigJQgaW4gYW4gdW5jYXVnaHRFeGNlcHRpb24gaGFuZGxlciB0aGlzIGlzXG5cdCAqIHRoZSBmYWlsaW5nIGV4ZWN1dGlvbidzIGZyYW1lOiB0aGUgcGFyZW50YWwgZWRnZSBpZCBwbHVzIGV2ZXJ5XG5cdCAqIGNvbnRleHQgaW5zdGFuY2UgcGlubmVkIGJ5IHRoZSBzY29wZS4gVW5kZWZpbmVkIG91dHNpZGUgYW55IHNjb3BlLlxuXHQgKi9cblx0Y3VycmVudEZyYW1lICgpOiBDcmFzaENvbnRleHQgfCB1bmRlZmluZWQge1xuXHRcdGNvbnN0IGZyYW1lID0gYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuIHVuZGVmaW5lZDtcblx0XHR9XG5cdFx0Y29uc3QgcmVzdWx0OiBDcmFzaENvbnRleHQgPSB7XG5cdFx0XHRlZGdlSWQgICAgOiBmcmFtZS5lZGdlSWQsXG5cdFx0XHRpbnN0YW5jZXMgOiBbLi4uZnJhbWUucGluU2V0XSxcblx0XHR9O1xuXHRcdGlmIChmcmFtZS5lZGdlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHJlc3VsdC5lZGdlID0gZnJhbWUuZWRnZTtcblx0XHR9XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdHByaXZhdGUgb25FbnRlciAoeyBlZGdlIH06IERpdmVFbnRlclBheWxvYWQpOiB2b2lkIHtcblx0XHRjb25zdCBjdXJyZW50ID0gYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFjdXJyZW50KSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGNvbnN0IGZyYW1lOiBGbG93RnJhbWUgPSB7XG5cdFx0XHRlZGdlSWQgOiBlZGdlLmlkLFxuXHRcdFx0ZWRnZSxcblx0XHRcdHBhcmVudCA6IGN1cnJlbnQsXG5cdFx0XHRwaW5TZXQgOiBjdXJyZW50LnBpblNldCxcblx0XHR9O1xuXHRcdGlmIChlZGdlLmluc3RhbmNlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdGZyYW1lLnBpblNldC5hZGQoZWRnZS5pbnN0YW5jZSk7XG5cdFx0fVxuXHRcdHRoaXMuZnJhbWVzLnNldChlZGdlLmlkLCBmcmFtZSk7XG5cdFx0YWxzLmVudGVyV2l0aChmcmFtZSk7XG5cdH1cblxuXHRwcml2YXRlIG9uTGVhdmUgKHsgZWRnZSB9OiBEaXZlTGVhdmVQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgZnJhbWUgPSB0aGlzLmZyYW1lcy5nZXQoZWRnZS5pZCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmZyYW1lcy5kZWxldGUoZWRnZS5pZCk7XG5cdFx0aWYgKGZyYW1lLnBhcmVudCkge1xuXHRcdFx0YWxzLmVudGVyV2l0aChmcmFtZS5wYXJlbnQpO1xuXHRcdH1cblx0fVxuXG5cdHByaXZhdGUgb25DcmVhdGUgKHsgZWRnZSB9OiBEaXZlQ3JlYXRlUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGN1cnJlbnQgPSBhbHMuZ2V0U3RvcmUoKTtcblx0XHRpZiAoIWN1cnJlbnQpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Ly8gQ29uc3RydWN0aW9ucyBhcmUgb25lLXNob3QgZWRnZXMgKG5vIGxlYXZlKSDigJQgbm8gZnJhbWUgb2YgdGhlaXJcblx0XHQvLyBvd24sIGJ1dCB0aGUgY29uc3RydWN0ZWQgaW5zdGFuY2UgaXMgREFUQTogcGluIGl0IGludG8gdGhlIHNjb3BlLlxuXHRcdGlmIChlZGdlLmluc3RhbmNlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdGN1cnJlbnQucGluU2V0LmFkZChlZGdlLmluc3RhbmNlKTtcblx0XHR9XG5cdH1cbn1cbiJdfQ==