"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncFlowProvider = void 0;
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
const async_hooks_1 = require("async_hooks");
const dive_api_js_1 = require("../dive-api.js");
class AsyncFlowProvider {
    // edgeId → the frame entered for it, so leave restores the exact parent
    frames = new Map();
    detachers = [];
    // the dive this provider subscribes to — the default dive unless the
    // caller traces through their own
    dive;
    // each provider's OWN store: two attached providers (a default-dive one
    // and an app-dive one) never read each other's frames
    als = new async_hooks_1.AsyncLocalStorage();
    constructor(options) {
        this.dive = (0, dive_api_js_1.resolveDive)(options);
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
exports.AsyncFlowProvider = AsyncFlowProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtZmxvdy5wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F1Qkc7QUFDSCw2Q0FBZ0Q7QUFDaEQsZ0RBSXdCO0FBbUN4QixNQUFhLGlCQUFpQjtJQUM3Qix3RUFBd0U7SUFDaEUsTUFBTSxHQUFHLElBQUksR0FBRyxFQUFxQixDQUFDO0lBQ3RDLFNBQVMsR0FBc0IsRUFBRSxDQUFDO0lBQzFDLHFFQUFxRTtJQUNyRSxrQ0FBa0M7SUFDMUIsSUFBSSxDQUFVO0lBQ3RCLHdFQUF3RTtJQUN4RSxzREFBc0Q7SUFDOUMsR0FBRyxHQUFHLElBQUksK0JBQWlCLEVBQWEsQ0FBQztJQUVqRCxZQUFhLE9BQW9CO1FBQ2hDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSx5QkFBVyxFQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTTtRQUNMLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDL0IsT0FBTztRQUNSLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDbEIsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDM0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN2QixDQUFDLENBQUMsRUFDRixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUMzQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxFQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFFB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QUFHLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2QsT0FBTztRQUNSLENBQUM7UUFDRCxrRUFBa0U7UUFDbEUsb0VBQW9FO1FBQ3BFLElBQUksSUFBSSxDQUFDLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNqQyxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDbkMsQ0FBQztJQUNGLENBQUM7Q0FDRDtBQXZIRCw4Q0F1SEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEFzeW5jLWZsb3cgcHJvdmlkZXIg4oCUIHRoZSBBTFMgYmFja2JvbmUgZm9yIGRpdmUgYXR0cmlidXRpb24uXG4gKlxuICogRGVzaWduOiByZXBvcnRzL2FzeW5jLWZsb3ctdHJhY2tpbmctZGVzaWduLm1kLlxuICpcbiAqIEVhY2ggcHJvdmlkZXIgY2FycmllcyBpdHMgT1dOIEFzeW5jTG9jYWxTdG9yYWdlIGhvbGRpbmcgYSBsaW5rZWQgbGlzdCBvZlxuICogRmxvd0ZyYW1lcyDigJQgdHdvIHByb3ZpZGVycyBhdHRhY2hlZCBhdCB0aGUgc2FtZSB0aW1lIChhIGRlZmF1bHQtZGl2ZSBvbmVcbiAqIGFuZCBhbiBhcHAtZGl2ZSBvbmUpIG5ldmVyIHJlYWQgZWFjaCBvdGhlcidzIGZyYW1lcy4gVGhlIHJvb3QgZnJhbWUgaXNcbiAqIGNyZWF0ZWQgcGVyIEhUVFAgcmVxdWVzdCBieSBNbmVtb25pY2FUcmFjZU1pZGRsZXdhcmUgKG9yIG1hbnVhbGx5IHZpYVxuICogcnVuSW5TY29wZSkuIEV2ZXJ5IGRpdmUgJ2VudGVyJyBob29rIHB1c2hlcyBhIGNoaWxkIGZyYW1lIChlZGdlSWQgPSB0aGVcbiAqIGVudGVyaW5nIGVkZ2UpOyAnbGVhdmUnIHJlc3RvcmVzIHRoZSBwYXJlbnQuIEFMUyBwcm9wYWdhdGlvbiB0aGVuIGRvZXNcbiAqIHRoZSB0cmFja2luZyBmb3IgZnJlZTogYW4gVU5XUkFQUEVEIGFzeW5jIGhvcCAoc2V0VGltZW91dCwgcHJvbWlzZVxuICogY29udGludWF0aW9uLCBhc3luYy1nZW5lcmF0b3Igc3VzcGVuc2lvbikgZmlyZXMgd2l0aCB0aGUgc2NoZWR1bGluZ1xuICogZnJhbWUgaW4gYWxzLmdldFN0b3JlKCkg4oCUIHRoZSBwYXJlbnRhbCBkaXZlIGVkZ2UgaXMga25vd24gd2l0aG91dFxuICogd3JhcHBpbmcgYW55dGhpbmcuXG4gKlxuICogVGhlIHNjb3BlZCBwaW46IHRoZSByb290IGZyYW1lIG93bnMgYSBwaW5TZXQgb2YgY29udGV4dCBpbnN0YW5jZXNcbiAqIChzdHJvbmcgcmVmcyksIGZpbGxlZCBvbiBlbnRlci9jcmVhdGUgZnJvbSBlZGdlLmluc3RhbmNlLiBMaWZldGltZSBpc1xuICogdGhlIHJlcXVlc3QncyBhc3luYyBleGVjdXRpb25zIOKAlCB3aGVuIHRoZXkgZGllLCB0aGUgc3RvcmUgYW5kIHBpblNldFxuICogZGllIHdpdGggdGhlbS4gZWRnZS5pbnN0YW5jZSBuZXZlciBkZXJlZnMgdG8gdW5kZWZpbmVkIG1pZC1yZXF1ZXN0LlxuICpcbiAqIE5vZGUtb25seSBieSBkZXNpZ246IGRpdmUgaW1wb3J0cyBubyBhc3luY19ob29rcyAoRGVuby9CdW4pLCB0aGVcbiAqIGFkYXB0ZXIgaXMgdGhlIE5vZGUgYm91bmRhcnkgd2hlcmUgQUxTIGlzIGZyZWUuXG4gKi9cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnYXN5bmNfaG9va3MnO1xuaW1wb3J0IHtcblx0cmVzb2x2ZURpdmUsXG5cdHR5cGUgRGl2ZUFwaSxcblx0dHlwZSBEaXZlT3B0aW9uLFxufSBmcm9tICcuLi9kaXZlLWFwaS5qcyc7XG5pbXBvcnQgdHlwZSB7XG5cdERpdmVDcmVhdGVQYXlsb2FkLFxuXHREaXZlRW50ZXJQYXlsb2FkLFxuXHREaXZlTGVhdmVQYXlsb2FkLFxuXHRGbG93RWRnZSxcbn0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcblxuZXhwb3J0IHR5cGUgRmxvd0ZyYW1lID0ge1xuXHQvKiogdGhlIGRpdmUgZWRnZSB0aGlzIGZyYW1lIGJlbG9uZ3MgdG8gKG51bGwgb24gdGhlIHJvb3QgZnJhbWUpICovXG5cdGVkZ2VJZCAgIDogbnVtYmVyIHwgbnVsbDtcblx0LyoqXG5cdCAqIHRoZSBlZGdlIG9iamVjdCBmcm9tIHRoZSBlbnRlciBwYXlsb2FkIOKAlCBkaXZlIGhhbmRzIHRoZSBMSVZFIGVkZ2UsIHNvXG5cdCAqIHRoZSBmcmFtZSBrZWVwcyBpdCAoYW5kLCB0aHJvdWdoIGRpdmUncyBwYXJlbnQgbGlua3MsIGl0cyBhbmNlc3RvcnMpXG5cdCAqIGFsaXZlIGFzIGxvbmcgYXMgdGhlIHNjb3BlJ3MgYXN5bmMgd29yayBsaXZlcy4gVGhhdCByZXRlbnRpb24gaXMgd2hhdFxuXHQgKiBtYWtlcyBjcmFzaC10aW1lIGZyYW1lIGF0dHJpYnV0aW9uIGV2aWRlbmNlLCB0aGUgc2FtZSB3YXkgYSBwZW5kaW5nXG5cdCAqIHRpbWVyIGtlZXBzIGl0cyBicmFuY2guXG5cdCAqL1xuXHRlZGdlPyAgICA6IEZsb3dFZGdlO1xuXHQvKiogdGhlIGZyYW1lIGFjdGl2ZSB3aGVuIHRoaXMgb25lIHdhcyBlbnRlcmVkICovXG5cdHBhcmVudCAgIDogRmxvd0ZyYW1lIHwgbnVsbDtcblx0LyoqIHN0cm9uZyBwaW5zIG9mIGNvbnRleHQgaW5zdGFuY2VzIOKAlCBPTkUgc2V0IHBlciBzY29wZSwgc2hhcmVkIGRvd25cblx0ICogIHRoZSBjaGFpbiBieSByZWZlcmVuY2U7IGRpZXMgd2l0aCB0aGUgc2NvcGUncyBhc3luYyBleGVjdXRpb25zICovXG5cdHBpblNldCAgIDogU2V0PG9iamVjdD47XG59O1xuXG4vKiogUmVhZC1vbmx5IGNyYXNoLXRpbWUgdmlldyBvZiB0aGUgYWN0aXZlIGZyYW1lLiAqL1xuZXhwb3J0IHR5cGUgQ3Jhc2hDb250ZXh0ID0ge1xuXHRlZGdlSWQgICAgOiBudW1iZXIgfCBudWxsO1xuXHQvKiogdGhlIGVudGVyaW5nIGVkZ2UgKHRoZSBMSVZFIGVkZ2Ug4oCUIHN0cm9uZ2x5IGhlbGQgYnkgdGhlIGZyYW1lLCBzb1xuXHQgKiAgYWxpdmUgd2hlbmV2ZXIgdGhlIGZyYW1lIGlzKSwgd2hlbiB0aGUgZnJhbWUgYmVsb25ncyB0byBhbiBlZGdlICovXG5cdGVkZ2U/ICAgICA6IEZsb3dFZGdlO1xuXHRpbnN0YW5jZXMgOiBvYmplY3RbXTtcbn07XG5cbmV4cG9ydCBjbGFzcyBBc3luY0Zsb3dQcm92aWRlciB7XG5cdC8vIGVkZ2VJZCDihpIgdGhlIGZyYW1lIGVudGVyZWQgZm9yIGl0LCBzbyBsZWF2ZSByZXN0b3JlcyB0aGUgZXhhY3QgcGFyZW50XG5cdHByaXZhdGUgZnJhbWVzID0gbmV3IE1hcDxudW1iZXIsIEZsb3dGcmFtZT4oKTtcblx0cHJpdmF0ZSBkZXRhY2hlcnM6IEFycmF5PCgpID0+IHZvaWQ+ID0gW107XG5cdC8vIHRoZSBkaXZlIHRoaXMgcHJvdmlkZXIgc3Vic2NyaWJlcyB0byDigJQgdGhlIGRlZmF1bHQgZGl2ZSB1bmxlc3MgdGhlXG5cdC8vIGNhbGxlciB0cmFjZXMgdGhyb3VnaCB0aGVpciBvd25cblx0cHJpdmF0ZSBkaXZlOiBEaXZlQXBpO1xuXHQvLyBlYWNoIHByb3ZpZGVyJ3MgT1dOIHN0b3JlOiB0d28gYXR0YWNoZWQgcHJvdmlkZXJzIChhIGRlZmF1bHQtZGl2ZSBvbmVcblx0Ly8gYW5kIGFuIGFwcC1kaXZlIG9uZSkgbmV2ZXIgcmVhZCBlYWNoIG90aGVyJ3MgZnJhbWVzXG5cdHByaXZhdGUgYWxzID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPEZsb3dGcmFtZT4oKTtcblxuXHRjb25zdHJ1Y3RvciAob3B0aW9ucz86IERpdmVPcHRpb24pIHtcblx0XHR0aGlzLmRpdmUgPSByZXNvbHZlRGl2ZShvcHRpb25zKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBTdWJzY3JpYmUgdG8gZGl2ZSdzIGVkZ2UgbGlmZWN5Y2xlLiBJZGVtcG90ZW50OiBhdHRhY2hpbmcgdHdpY2Ugd291bGRcblx0ICogZG91YmxlIGV2ZXJ5IGZyYW1lIHB1c2guIERpdmUncyBjbGVhcigpIHdpcGVzIHN1YnNjcmliZXJzIOKAlCByZS1hdHRhY2hcblx0ICogYWZ0ZXIgaXQuXG5cdCAqL1xuXHRhdHRhY2ggKCk6IHZvaWQge1xuXHRcdGlmICh0aGlzLmRldGFjaGVycy5sZW5ndGggPiAwKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzLnB1c2goXG5cdFx0XHR0aGlzLmRpdmUucmVnaXN0ZXJIb29rKCdlbnRlcicsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25FbnRlcihwYXlsb2FkKTtcblx0XHRcdH0pLFxuXHRcdFx0dGhpcy5kaXZlLnJlZ2lzdGVySG9vaygnbGVhdmUnLCAocGF5bG9hZCkgPT4ge1xuXHRcdFx0XHR0aGlzLm9uTGVhdmUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHRcdHRoaXMuZGl2ZS5yZWdpc3Rlckhvb2soJ2NyZWF0ZScsIChwYXlsb2FkKSA9PiB7XG5cdFx0XHRcdHRoaXMub25DcmVhdGUocGF5bG9hZCk7XG5cdFx0XHR9KSxcblx0XHQpO1xuXHR9XG5cblx0ZGV0YWNoICgpOiB2b2lkIHtcblx0XHRmb3IgKGNvbnN0IGRldGFjaCBvZiB0aGlzLmRldGFjaGVycykge1xuXHRcdFx0ZGV0YWNoKCk7XG5cdFx0fVxuXHRcdHRoaXMuZGV0YWNoZXJzID0gW107XG5cdFx0dGhpcy5mcmFtZXMuY2xlYXIoKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBFc3RhYmxpc2ggYSByb290IGZyYW1lIGZvciBub24tSFRUUCBzY29wZXMgKHF1ZXVlIGNvbnN1bWVycywgQ0xJLFxuXHQgKiB0ZXN0cykuIFRoZSBtaWRkbGV3YXJlIGlzIHRoZSBIVFRQIHJvb3QuXG5cdCAqL1xuXHRydW5JblNjb3BlPFQ+IChmbjogKCkgPT4gVCk6IFQge1xuXHRcdGNvbnN0IHJvb3Q6IEZsb3dGcmFtZSA9IHtcblx0XHRcdGVkZ2VJZCA6IG51bGwsXG5cdFx0XHRwYXJlbnQgOiBudWxsLFxuXHRcdFx0cGluU2V0IDogbmV3IFNldDxvYmplY3Q+KCksXG5cdFx0fTtcblx0XHRjb25zdCByZXN1bHQgPSB0aGlzLmFscy5ydW4ocm9vdCwgZm4pO1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHQvKipcblx0ICogVGhlIGZyYW1lIGFjdGl2ZSBSSUdIVCBOT1cg4oCUIGluIGFuIHVuY2F1Z2h0RXhjZXB0aW9uIGhhbmRsZXIgdGhpcyBpc1xuXHQgKiB0aGUgZmFpbGluZyBleGVjdXRpb24ncyBmcmFtZTogdGhlIHBhcmVudGFsIGVkZ2UgaWQgcGx1cyBldmVyeVxuXHQgKiBjb250ZXh0IGluc3RhbmNlIHBpbm5lZCBieSB0aGUgc2NvcGUuIFVuZGVmaW5lZCBvdXRzaWRlIGFueSBzY29wZS5cblx0ICovXG5cdGN1cnJlbnRGcmFtZSAoKTogQ3Jhc2hDb250ZXh0IHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBmcmFtZSA9IHRoaXMuYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuIHVuZGVmaW5lZDtcblx0XHR9XG5cdFx0Y29uc3QgcmVzdWx0OiBDcmFzaENvbnRleHQgPSB7XG5cdFx0XHRlZGdlSWQgICAgOiBmcmFtZS5lZGdlSWQsXG5cdFx0XHRpbnN0YW5jZXMgOiBbIC4uLmZyYW1lLnBpblNldCBdLFxuXHRcdH07XG5cdFx0aWYgKGZyYW1lLmVkZ2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0cmVzdWx0LmVkZ2UgPSBmcmFtZS5lZGdlO1xuXHRcdH1cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0cHJpdmF0ZSBvbkVudGVyICh7IGVkZ2UgfTogRGl2ZUVudGVyUGF5bG9hZCk6IHZvaWQge1xuXHRcdGNvbnN0IGN1cnJlbnQgPSB0aGlzLmFscy5nZXRTdG9yZSgpO1xuXHRcdGlmICghY3VycmVudCkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRjb25zdCBmcmFtZTogRmxvd0ZyYW1lID0ge1xuXHRcdFx0ZWRnZUlkIDogZWRnZS5pZCxcblx0XHRcdGVkZ2UsXG5cdFx0XHRwYXJlbnQgOiBjdXJyZW50LFxuXHRcdFx0cGluU2V0IDogY3VycmVudC5waW5TZXQsXG5cdFx0fTtcblx0XHRpZiAoZWRnZS5pbnN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRmcmFtZS5waW5TZXQuYWRkKGVkZ2UuaW5zdGFuY2UpO1xuXHRcdH1cblx0XHR0aGlzLmZyYW1lcy5zZXQoZWRnZS5pZCwgZnJhbWUpO1xuXHRcdHRoaXMuYWxzLmVudGVyV2l0aChmcmFtZSk7XG5cdH1cblxuXHRwcml2YXRlIG9uTGVhdmUgKHsgZWRnZSB9OiBEaXZlTGVhdmVQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgZnJhbWUgPSB0aGlzLmZyYW1lcy5nZXQoZWRnZS5pZCk7XG5cdFx0aWYgKCFmcmFtZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHR0aGlzLmZyYW1lcy5kZWxldGUoZWRnZS5pZCk7XG5cdFx0aWYgKGZyYW1lLnBhcmVudCkge1xuXHRcdFx0dGhpcy5hbHMuZW50ZXJXaXRoKGZyYW1lLnBhcmVudCk7XG5cdFx0fVxuXHR9XG5cblx0cHJpdmF0ZSBvbkNyZWF0ZSAoeyBlZGdlIH06IERpdmVDcmVhdGVQYXlsb2FkKTogdm9pZCB7XG5cdFx0Y29uc3QgY3VycmVudCA9IHRoaXMuYWxzLmdldFN0b3JlKCk7XG5cdFx0aWYgKCFjdXJyZW50KSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdC8vIENvbnN0cnVjdGlvbnMgYXJlIG9uZS1zaG90IGVkZ2VzIChubyBsZWF2ZSkg4oCUIG5vIGZyYW1lIG9mIHRoZWlyXG5cdFx0Ly8gb3duLCBidXQgdGhlIGNvbnN0cnVjdGVkIGluc3RhbmNlIGlzIERBVEE6IHBpbiBpdCBpbnRvIHRoZSBzY29wZS5cblx0XHRpZiAoZWRnZS5pbnN0YW5jZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRjdXJyZW50LnBpblNldC5hZGQoZWRnZS5pbnN0YW5jZSk7XG5cdFx0fVxuXHR9XG59XG4iXX0=