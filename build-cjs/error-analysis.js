"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureError = captureError;
exports.analyseError = analyseError;
exports.recordErrorAnalysis = recordErrorAnalysis;
/**
 * Error analysis — error → its dive edge → its instances.
 *
 * On uncaughtException /
 * unhandledRejection there is an error to analyse; this module finds
 * WHICH dive edge it came from, walks that edge's chain, and collects the
 * instances wired to it — returning DATA, never printing anything (the
 * caller decides what to log; nothing here writes to stdout or console).
 *
 * Two phases, because after uncaughtException the pod may be killed and
 * deferred work may never run:
 *
 * - captureError(error, deps?) — PHASE 1, synchronous and cheap: keeps
 *   REFERENCES only (the error, the async-flow frame's edge and
 *   pinned instances when a provider is given, dive.current()). No stack
 *   reading, no graphs.
 * - analyseError(capture, budget?) — PHASE 2, only when the caller asks:
 *   picks the edge chain from the FIRST source that has one —
 *     (a) getFlow(error)              — the error was pinned by dive's own
 *                                       wrapper: EVIDENCE;
 *     (b) getFlow(frame.edge)         — the ALS frame at crash time: also
 *                                       EVIDENCE on Node. Dive hands the
 *                                       LIVE edge in the enter payload, and
 *                                       the frame keeps it (plus, through
 *                                       dive's parent links, its ancestors)
 *                                       alive as long as the scope's async
 *                                       work lives — the same way a pending
 *                                       timer keeps its branch. The edge
 *                                       cannot be "already collected" while
 *                                       the frame exists;
 *     (c) getFlow(capture.current)    — dive's rest residue: a labelled
 *                                       GUESS, never evidence;
 *     (d) none                        — source 'none'.
 *   One core utils.lineage graph is built over the DISTINCT LIVE instances
 *   of the chain (collected instances are skipped and counted). Budget {
 *   maxEdges, maxInstances } bounds the work; every truncation is reported
 *   in the result, never silent.
 *
 * - recordErrorAnalysis(analysis, span) puts the result on a span THE
 *   CALLER PASSES: one 'mnemonica.error' event with the lineage graph JSON
 *   in 'mnemonica.lineage.graph' plus the source and the evidence flag.
 */
const dive_api_js_1 = require("./dive-api.js");
const module_1 = require("mnemonica/module");
/** the span event and attribute names — the cross-language contract */
const EVENT_ERROR = 'mnemonica.error';
const ATTR_LINEAGE_GRAPH = 'mnemonica.lineage.graph';
const ATTR_SOURCE = 'mnemonica.error.source';
const ATTR_EVIDENCE = 'mnemonica.error.evidence';
const DEFAULT_MAX_EDGES = 32;
const DEFAULT_MAX_INSTANCES = 16;
function captureError(error, deps) {
    const dive = (0, dive_api_js_1.resolveDive)(deps);
    const frame = deps?.asyncFlow?.currentFrame();
    const capture = {
        error,
        frameInstances: frame?.instances ?? [],
        current: dive.current() ?? null,
        dive,
    };
    if (frame?.edge !== undefined) {
        capture.frameEdge = frame.edge;
    }
    return capture;
}
// the attempted constructor args of a FAILED mnemonica construction ride
// the errored shell itself: getProps exposes { args, originalError, … } off
// the props WeakMap. Degrades to undefined — never throws on this path.
const erroredArgsSafe = (error) => {
    try {
        const props = (0, module_1.getProps)(error);
        const result = props?.args;
        return result;
    }
    catch {
        const result = undefined;
        return result;
    }
};
const isFailedConstruction = (error) => {
    const failedCheck = error instanceof Error && (0, module_1.getProps)(error) !== undefined;
    return failedCheck;
};
function analyseError(capture, budget = {}) {
    const dive = capture.dive ?? (0, dive_api_js_1.resolveDive)();
    const maxEdges = budget.maxEdges ?? DEFAULT_MAX_EDGES;
    const maxInstances = budget.maxInstances ?? DEFAULT_MAX_INSTANCES;
    const message = capture.error instanceof Error
        ? capture.error.message
        : String(capture.error);
    // --- pick the chain from the FIRST source that has one
    let source = 'none';
    let evidence = false;
    let chain = [];
    if (capture.error instanceof Error) {
        const fromError = dive.getFlow(capture.error);
        if (fromError.length > 0) {
            source = 'error';
            evidence = true;
            chain = fromError;
        }
    }
    if (source === 'none' && capture.frameEdge !== undefined) {
        // the frame holds the LIVE edge (dive's enter payload), alive as
        // long as the frame — getFlow cannot come back empty here
        const fromFrame = dive.getFlow(capture.frameEdge);
        if (fromFrame.length > 0) {
            source = 'async-frame';
            evidence = true;
            chain = fromFrame;
        }
    }
    if (source === 'none' && capture.current !== null) {
        const fromCurrent = dive.getFlow(capture.current);
        if (fromCurrent.length > 0) {
            source = 'last-context';
            evidence = false;
            chain = fromCurrent;
        }
    }
    // --- budget the chain: the failure-proximal TAIL is kept
    const edgesTruncated = Math.max(0, chain.length - maxEdges);
    const keptEdges = chain.slice(-maxEdges);
    const edges = keptEdges.map((edge) => {
        const analysed = {
            kind: edge.kind,
            name: edge.name,
            status: edge.status,
        };
        if (edge.callsite !== undefined) {
            analysed.callsite = edge.callsite;
        }
        return analysed;
    });
    // --- the error itself IS a failed mnemonica construction
    let failedConstruction;
    if (isFailedConstruction(capture.error)) {
        const props = (0, module_1.getProps)(capture.error);
        const typeName = props?.__type__?.TypeName ?? capture.error.constructor.name;
        failedConstruction = {
            typeName,
            attemptedArgs: erroredArgsSafe(capture.error),
        };
    }
    // --- ONE lineage graph over the DISTINCT LIVE instances of the chain
    const seen = new Set();
    const liveInstances = [];
    let instancesSkipped = 0;
    for (const edge of keptEdges) {
        const { instance } = edge;
        if (instance === undefined) {
            // count only instances that WERE there and got collected;
            // edges recorded without an instance are not skipped data
            if (edge.instanceCollected === true) {
                instancesSkipped += 1;
            }
            continue;
        }
        if (seen.has(instance)) {
            continue;
        }
        seen.add(instance);
        liveInstances.push(instance);
    }
    const instancesTruncated = Math.max(0, liveInstances.length - maxInstances);
    const keptInstances = liveInstances.slice(0, maxInstances);
    const lineage = keptInstances.length > 0
        ? module_1.utils.lineage(keptInstances)
        : null;
    const analysis = {
        source,
        evidence,
        message,
        edges,
        edgesTruncated,
        lineage,
        instances: keptInstances.length,
        instancesSkipped,
        instancesTruncated,
    };
    if (failedConstruction !== undefined) {
        analysis.failedConstruction = failedConstruction;
    }
    return analysis;
}
/**
 * Put the analysis on a span THE CALLER PASSES — one 'mnemonica.error'
 * event: the lineage graph JSON in 'mnemonica.lineage.graph', plus the
 * source and the evidence flag. No span is created here; no stdout.
 */
function recordErrorAnalysis(analysis, span) {
    const attributes = {
        [ATTR_SOURCE]: analysis.source,
        [ATTR_EVIDENCE]: analysis.evidence,
    };
    if (analysis.lineage !== null) {
        attributes[ATTR_LINEAGE_GRAPH] = JSON.stringify(analysis.lineage);
    }
    span.addEvent(EVENT_ERROR, attributes);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItYW5hbHlzaXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZXJyb3ItYW5hbHlzaXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFrSUEsb0NBYUM7QUFxQkQsb0NBZ0hDO0FBT0Qsa0RBU0M7QUFwU0Q7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUNHO0FBQ0gsK0NBR3VCO0FBRXZCLDZDQUUwQjtBQVExQix1RUFBdUU7QUFDdkUsTUFBTSxXQUFXLEdBQUcsaUJBQWlCLENBQUM7QUFDdEMsTUFBTSxrQkFBa0IsR0FBRyx5QkFBeUIsQ0FBQztBQUNyRCxNQUFNLFdBQVcsR0FBRyx3QkFBd0IsQ0FBQztBQUM3QyxNQUFNLGFBQWEsR0FBRywwQkFBMEIsQ0FBQztBQWtCakQsTUFBTSxpQkFBaUIsR0FBRyxFQUFFLENBQUM7QUFDN0IsTUFBTSxxQkFBcUIsR0FBRyxFQUFFLENBQUM7QUFrRGpDLFNBQWdCLFlBQVksQ0FBRSxLQUFjLEVBQUUsSUFBd0I7SUFDckUsTUFBTSxJQUFJLEdBQUcsSUFBQSx5QkFBVyxFQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9CLE1BQU0sS0FBSyxHQUFHLElBQUksRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLENBQUM7SUFDOUMsTUFBTSxPQUFPLEdBQWlCO1FBQzdCLEtBQUs7UUFDTCxjQUFjLEVBQUcsS0FBSyxFQUFFLFNBQVMsSUFBSSxFQUFFO1FBQ3ZDLE9BQU8sRUFBVSxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksSUFBSTtRQUN2QyxJQUFJO0tBQ0osQ0FBQztJQUNGLElBQUksS0FBSyxFQUFFLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixPQUFPLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7SUFDaEMsQ0FBQztJQUNELE9BQU8sT0FBTyxDQUFDO0FBQ2hCLENBQUM7QUFFRCx5RUFBeUU7QUFDekUsNEVBQTRFO0FBQzVFLHdF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QUNELE9BQU8sUUFBUSxDQUFDO0FBQ2pCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQUUsUUFBdUIsRUFBRSxJQUFVO0lBQ3ZFLE1BQU0sVUFBVSxHQUFxQztRQUNwRCxDQUFFLFdBQVcsQ0FBRSxFQUFLLFFBQVEsQ0FBQyxNQUFNO1FBQ25DLENBQUUsYUFBYSxDQUFFLEVBQUcsUUFBUSxDQUFDLFFBQVE7S0FDckMsQ0FBQztJQUNGLElBQUksUUFBUSxDQUFDLE9BQU8sS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUMvQixVQUFVLENBQUUsa0JBQWtCLENBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyRSxDQUFDO0lBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLENBQUM7QUFDeEMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRXJyb3IgYW5hbHlzaXMg4oCUIGVycm9yIOKGkiBpdHMgZGl2ZSBlZGdlIOKGkiBpdHMgaW5zdGFuY2VzLlxuICpcbiAqIE9uIHVuY2F1Z2h0RXhjZXB0aW9uIC9cbiAqIHVuaGFuZGxlZFJlamVjdGlvbiB0aGVyZSBpcyBhbiBlcnJvciB0byBhbmFseXNlOyB0aGlzIG1vZHVsZSBmaW5kc1xuICogV0hJQ0ggZGl2ZSBlZGdlIGl0IGNhbWUgZnJvbSwgd2Fsa3MgdGhhdCBlZGdlJ3MgY2hhaW4sIGFuZCBjb2xsZWN0cyB0aGVcbiAqIGluc3RhbmNlcyB3aXJlZCB0byBpdCDigJQgcmV0dXJuaW5nIERBVEEsIG5ldmVyIHByaW50aW5nIGFueXRoaW5nICh0aGVcbiAqIGNhbGxlciBkZWNpZGVzIHdoYXQgdG8gbG9nOyBub3RoaW5nIGhlcmUgd3JpdGVzIHRvIHN0ZG91dCBvciBjb25zb2xlKS5cbiAqXG4gKiBUd28gcGhhc2VzLCBiZWNhdXNlIGFmdGVyIHVuY2F1Z2h0RXhjZXB0aW9uIHRoZSBwb2QgbWF5IGJlIGtpbGxlZCBhbmRcbiAqIGRlZmVycmVkIHdvcmsgbWF5IG5ldmVyIHJ1bjpcbiAqXG4gKiAtIGNhcHR1cmVFcnJvcihlcnJvciwgZGVwcz8pIOKAlCBQSEFTRSAxLCBzeW5jaHJvbm91cyBhbmQgY2hlYXA6IGtlZXBzXG4gKiAgIFJFRkVSRU5DRVMgb25seSAodGhlIGVycm9yLCB0aGUgYXN5bmMtZmxvdyBmcmFtZSdzIGVkZ2UgYW5kXG4gKiAgIHBpbm5lZCBpbnN0YW5jZXMgd2hlbiBhIHByb3ZpZGVyIGlzIGdpdmVuLCBkaXZlLmN1cnJlbnQoKSkuIE5vIHN0YWNrXG4gKiAgIHJlYWRpbmcsIG5vIGdyYXBocy5cbiAqIC0gYW5hbHlzZUVycm9yKGNhcHR1cmUsIGJ1ZGdldD8pIOKAlCBQSEFTRSAyLCBvbmx5IHdoZW4gdGhlIGNhbGxlciBhc2tzOlxuICogICBwaWNrcyB0aGUgZWRnZSBjaGFpbiBmcm9tIHRoZSBGSVJTVCBzb3VyY2UgdGhhdCBoYXMgb25lIOKAlFxuICogICAgIChhKSBnZXRGbG93KGVycm9yKSAgICAgICAgICAgICAg4oCUIHRoZSBlcnJvciB3YXMgcGlubmVkIGJ5IGRpdmUncyBvd25cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd3JhcHBlcjogRVZJREVOQ0U7XG4gKiAgICAgKGIpIGdldEZsb3coZnJhbWUuZWRnZSkgICAgICAgICDigJQgdGhlIEFMUyBmcmFtZSBhdCBjcmFzaCB0aW1lOiBhbHNvXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVWSURFTkNFIG9uIE5vZGUuIERpdmUgaGFuZHMgdGhlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIExJVkUgZWRnZSBpbiB0aGUgZW50ZXIgcGF5bG9hZCwgYW5kXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBmcmFtZSBrZWVwcyBpdCAocGx1cywgdGhyb3VnaFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXZlJ3MgcGFyZW50IGxpbmtzLCBpdHMgYW5jZXN0b3JzKVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGl2ZSBhcyBsb25nIGFzIHRoZSBzY29wZSdzIGFzeW5jXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmsgbGl2ZXMg4oCUIHRoZSBzYW1lIHdheSBhIHBlbmRpbmdcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZXIga2VlcHMgaXRzIGJyYW5jaC4gVGhlIGVkZ2VcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2Fubm90IGJlIFwiYWxyZWFkeSBjb2xsZWN0ZWRcIiB3aGlsZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgZnJhbWUgZXhpc3RzO1xuICogICAgIChjKSBnZXRGbG93KGNhcHR1cmUuY3VycmVudCkgICAg4oCUIGRpdmUncyByZXN0IHJlc2lkdWU6IGEgbGFiZWxsZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgR1VFU1MsIG5ldmVyIGV2aWRlbmNlO1xuICogICAgIChkKSBub25lICAgICAgICAgICAgICAgICAgICAgICAg4oCUIHNvdXJjZSAnbm9uZScuXG4gKiAgIE9uZSBjb3JlIHV0aWxzLmxpbmVhZ2UgZ3JhcGggaXMgYnVpbHQgb3ZlciB0aGUgRElTVElOQ1QgTElWRSBpbnN0YW5jZXNcbiAqICAgb2YgdGhlIGNoYWluIChjb2xsZWN0ZWQgaW5zdGFuY2VzIGFyZSBza2lwcGVkIGFuZCBjb3VudGVkKS4gQnVkZ2V0IHtcbiAqICAgbWF4RWRnZXMsIG1heEluc3RhbmNlcyB9IGJvdW5kcyB0aGUgd29yazsgZXZlcnkgdHJ1bmNhdGlvbiBpcyByZXBvcnRlZFxuICogICBpbiB0aGUgcmVzdWx0LCBuZXZlciBzaWxlbnQuXG4gKlxuICogLSByZWNvcmRFcnJvckFuYWx5c2lzKGFuYWx5c2lzLCBzcGFuKSBwdXRzIHRoZSByZXN1bHQgb24gYSBzcGFuIFRIRVxuICogICBDQUxMRVIgUEFTU0VTOiBvbmUgJ21uZW1vbmljYS5lcnJvcicgZXZlbnQgd2l0aCB0aGUgbGluZWFnZSBncmFwaCBKU09OXG4gKiAgIGluICdtbmVtb25pY2EubGluZWFnZS5ncmFwaCcgcGx1cyB0aGUgc291cmNlIGFuZCB0aGUgZXZpZGVuY2UgZmxhZy5cbiAqL1xuaW1wb3J0IHtcblx0cmVzb2x2ZURpdmUsXG5cdHR5cGUgRGl2ZUFwaSxcbn0gZnJvbSAnLi9kaXZlLWFwaS5qcyc7XG5pbXBvcnQgdHlwZSB7IEZsb3dFZGdlIH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB7XG5cdHV0aWxzLCBnZXRQcm9wcyBcbn0gZnJvbSAnbW5lbW9uaWNhL21vZHVsZSc7XG5pbXBvcnQgdHlwZSB7IFNwYW4gfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHR5cGUgeyBBc3luY0Zsb3dQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXJzL2FzeW5jLWZsb3cucHJvdmlkZXIuanMnO1xuXG4vKiogY29yZSBkb2VzIG5vdCByZS1leHBvcnQgdGhlIExpbmVhZ2VHcmFwaCBuYW1lIGZyb20gaXRzIGVudHJ5IGQudHMg4oCUXG4gKiAgdGhlIGdyYXBoIHR5cGUgaXMgZXhhY3RseSB3aGF0IHV0aWxzLmxpbmVhZ2UgcmV0dXJucyAqL1xudHlwZSBMaW5lYWdlR3JhcGggPSBSZXR1cm5UeXBlPHR5cGVvZiB1dGlscy5saW5lYWdlPjtcblxuLyoqIHRoZSBzcGFuIGV2ZW50IGFuZCBhdHRyaWJ1dGUgbmFtZXMg4oCUIHRoZSBjcm9zcy1sYW5ndWFnZSBjb250cmFjdCAqL1xuY29uc3QgRVZFTlRfRVJST1IgPSAnbW5lbW9uaWNhLmVycm9yJztcbmNvbnN0IEFUVFJfTElORUFHRV9HUkFQSCA9ICdtbmVtb25pY2EubGluZWFnZS5ncmFwaCc7XG5jb25zdCBBVFRSX1NPVVJDRSA9ICdtbmVtb25pY2EuZXJyb3Iuc291cmNlJztcbmNvbnN0IEFUVFJfRVZJREVOQ0UgPSAnbW5lbW9uaWNhLmVycm9yLmV2aWRlbmNlJztcblxuZXhwb3J0IHR5cGUgRXJyb3JTb3VyY2UgPSAnZXJyb3InIHwgJ2FzeW5jLWZyYW1lJyB8ICdsYXN0LWNvbnRleHQnIHwgJ25vbmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQW5hbHlzaXNEZXBzIHtcblx0YXN5bmNGbG93PzogQXN5bmNGbG93UHJvdmlkZXI7XG5cdC8qKiB0aGUgZGl2ZSB0byByZWFkIHRoZSB0cmFjZSBmcm9tIOKAlCB0aGUgZGVmYXVsdCBkaXZlIHVubGVzcyB0aGUgY2FsbGVyXG5cdCAqICB0cmFjZXMgdGhyb3VnaCB0aGVpciBvd24gKi9cblx0ZGl2ZT86IERpdmVBcGk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5hbHlzaXNCdWRnZXQge1xuXHQvKiogY2hhaW4gbGVuZ3RoIGNhcDsgdGhlIGZhaWx1cmUtcHJveGltYWwgVEFJTCBpcyBrZXB0ICovXG5cdG1heEVkZ2VzPyAgICAgOiBudW1iZXI7XG5cdC8qKiBkaXN0aW5jdCBsaXZlIGluc3RhbmNlcyBmZWQgaW50byB0aGUgbGluZWFnZSBncmFwaCAqL1xuXHRtYXhJbnN0YW5jZXM/IDogbnVtYmVyO1xufVxuXG5jb25zdCBERUZBVUxUX01BWF9FREdFUyA9IDMyO1xuY29uc3QgREVGQVVMVF9NQVhfSU5TVEFOQ0VTID0gMTY7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5hbHlzZWRFZGdlIHtcblx0a2luZCAgICAgOiBzdHJpbmc7XG5cdG5hbWUgICAgIDogc3RyaW5nO1xuXHRzdGF0dXMgICA6IHN0cmluZztcblx0Y2FsbHNpdGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JBbmFseXNpcyB7XG5cdHNvdXJjZSAgICAgICAgICAgICAgIDogRXJyb3JTb3VyY2U7XG5cdGV2aWRlbmNlICAgICAgICAgICAgIDogYm9vbGVhbjtcblx0bWVzc2FnZSAgICAgICAgICAgICAgOiBzdHJpbmc7XG5cdGVkZ2VzICAgICAgICAgICAgICAgIDogQW5hbHlzZWRFZGdlW107XG5cdC8qKiBjaGFpbiBlZGdlcyBjdXQgYnkgbWF4RWRnZXMgKHRoZSBmYWlsdXJlLXByb3hpbWFsIHRhaWwgd2FzIGtlcHQpICovXG5cdGVkZ2VzVHJ1bmNhdGVkICAgICAgIDogbnVtYmVyO1xuXHQvKiogdGhlIGVycm9yIGl0c2VsZiBJUyBhIGZhaWxlZCBtbmVtb25pY2EgY29uc3RydWN0aW9uICovXG5cdGZhaWxlZENvbnN0cnVjdGlvbj8gIDoge1xuXHRcdHR5cGVOYW1lICAgICA6IHN0cmluZztcblx0XHRhdHRlbXB0ZWRBcmdzOiB1bmtub3duO1xuXHR9O1xuXHQvKiogT05FIGNvcmUgdXRpbHMubGluZWFnZSBncmFwaCBvdmVyIHRoZSBjaGFpbidzIGRpc3RpbmN0IGxpdmVcblx0ICogIGluc3RhbmNlczsgbnVsbCB3aGVuIHRoZSBjaGFpbiBjYXJyaWVkIG5vbmUgKi9cblx0bGluZWFnZSAgICAgICAgICAgICAgOiBMaW5lYWdlR3JhcGggfCBudWxsO1xuXHRpbnN0YW5jZXMgICAgICAgICAgICA6IG51bWJlcjtcblx0LyoqIGNoYWluIGVkZ2VzIHdob3NlIGluc3RhbmNlIHdhcyBhbHJlYWR5IGNvbGxlY3RlZCDigJQgc2tpcHBlZCwgY291bnRlZCAqL1xuXHRpbnN0YW5jZXNTa2lwcGVkICAgICA6IG51bWJlcjtcblx0LyoqIGxpdmUgaW5zdGFuY2VzIGN1dCBieSBtYXhJbnN0YW5jZXMgKG5ldmVyIGVudGVyZWQgdGhlIGdyYXBoKSAqL1xuXHRpbnN0YW5jZXNUcnVuY2F0ZWQgICA6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBQSEFTRSAxIOKAlCBzeW5jaHJvbm91cyBjYXB0dXJlIG9mIFJFRkVSRU5DRVMgb25seS4gU2FmZSBpbnNpZGUgYW5cbiAqIHVuY2F1Z2h0RXhjZXB0aW9uIGhhbmRsZXI6IG5vIHN0YWNrIHJlYWRpbmcsIG5vIGdyYXBoIGJ1aWxkaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQ2FwdHVyZSB7XG5cdGVycm9yICAgICAgICAgIDogdW5rbm93bjtcblx0LyoqIHRoZSBBTFMgZnJhbWUncyBlZGdlICh0aGUgTElWRSBlZGdlIGRpdmUgaGFuZHMgaW4gdGhlIGVudGVyIHBheWxvYWQpLFxuXHQgKiAgd2hlbiBhIHByb3ZpZGVyIHdhcyBnaXZlbiBhdCBjYXB0dXJlIOKAlCB0aGUgZnJhbWUga2VlcHMgaXQgYWxpdmUgKi9cblx0ZnJhbWVFZGdlPyAgICAgOiBGbG93RWRnZTtcblx0LyoqIHRoZSBmcmFtZSdzIHBpbm5lZCBjb250ZXh0IGluc3RhbmNlcyAoc3Ryb25nIHJlZnMsIHJlcXVlc3QtbGlmZXRpbWUpICovXG5cdGZyYW1lSW5zdGFuY2VzIDogb2JqZWN0W107XG5cdC8qKiBkaXZlLmN1cnJlbnQoKSBhdCBjYXB0dXJlIHRpbWUg4oCUIHRoZSByZXN0IHJlc2lkdWUgKi9cblx0Y3VycmVudCAgICAgICAgOiBvYmplY3QgfCBudWxsO1xuXHQvKiogdGhlIGRpdmUgdGhlIHRyYWNlIGlzIHJlYWQgZnJvbSBhdCBhbmFseXNlIHRpbWUg4oCUIHJlc29sdmVkIGF0XG5cdCAqICBjYXB0dXJlICh0aGUgZGVmYXVsdCBkaXZlIHdoZW4gbm9uZSB3YXMgZ2l2ZW4pIHNvIHRoZSBjYXB0dXJlIGFsb25lXG5cdCAqICBpcyBlbm91Z2ggZm9yIGFuYWx5c2VFcnJvciAqL1xuXHRkaXZlPyAgICAgICAgICA6IERpdmVBcGk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlRXJyb3IgKGVycm9yOiB1bmtub3duLCBkZXBzPzogRXJyb3JBbmFseXNpc0RlcHMpOiBFcnJvckNhcHR1cmUge1xuXHRjb25zdCBkaXZlID0gcmVzb2x2ZURpdmUoZGVwcyk7XG5cdGNvbnN0IGZyYW1lID0gZGVwcz8uYXN5bmNGbG93Py5jdXJyZW50RnJhbWUoKTtcblx0Y29uc3QgY2FwdHVyZTogRXJyb3JDYXB0dXJlID0ge1xuXHRcdGVycm9yLFxuXHRcdGZyYW1lSW5zdGFuY2VzIDogZnJhbWU/Lmluc3RhbmNlcyA/PyBbXSxcblx0XHRjdXJyZW50ICAgICAgICA6IGRpdmUuY3VycmVudCgpID8/IG51bGwsXG5cdFx0ZGl2ZSxcblx0fTtcblx0aWYgKGZyYW1lPy5lZGdlICE9PSB1bmRlZmluZWQpIHtcblx0XHRjYXB0dXJlLmZyYW1lRWRnZSA9IGZyYW1lLmVkZ2U7XG5cdH1cblx0cmV0dXJuIGNhcHR1cmU7XG59XG5cbi8vIHRoZSBhdHRlbXB0ZWQgY29uc3RydWN0b3IgYXJncyBvZiBhIEZBSUxFRCBtbmVtb25pY2EgY29uc3RydWN0aW9uIHJpZGVcbi8vIHRoZSBlcnJvcmVkIHNoZWxsIGl0c2VsZjogZ2V0UHJvcHMgZXhwb3NlcyB7IGFyZ3MsIG9yaWdpbmFsRXJyb3IsIOKApiB9IG9mZlxuLy8gdGhlIHByb3BzIFdlYWtNYXAuIERlZ3JhZGVzIHRvIHVuZGVmaW5lZCDigJQgbmV2ZXIgdGhyb3dzIG9uIHRoaXMgcGF0aC5cbmNvbnN0IGVycm9yZWRBcmdzU2FmZSA9IChlcnJvcjogRXJyb3IpOiB1bmtub3duID0+IHtcblx0dHJ5IHtcblx0XHRjb25zdCBwcm9wcyA9IGdldFByb3BzKGVycm9yKSBhcyB7IGFyZ3M/OiB1bmtub3duIH0gfCB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgcmVzdWx0ID0gcHJvcHM/LmFyZ3M7XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fSBjYXRjaCB7XG5cdFx0Y29uc3QgcmVzdWx0ID0gdW5kZWZpbmVkO1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cbn07XG5cbmNvbnN0IGlzRmFpbGVkQ29uc3RydWN0aW9uID0gKGVycm9yOiB1bmtub3duKTogZXJyb3IgaXMgRXJyb3IgPT4ge1xuXHRjb25zdCBmYWlsZWRDaGVjayA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZ2V0UHJvcHMoZXJyb3IpICE9PSB1bmRlZmluZWQ7XG5cdHJldHVybiBmYWlsZWRDaGVjaztcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBhbmFseXNlRXJyb3IgKFxuXHRjYXB0dXJlICA6IEVycm9yQ2FwdHVyZSxcblx0YnVkZ2V0ICAgOiBBbmFseXNpc0J1ZGdldCA9IHt9LFxuKTogRXJyb3JBbmFseXNpcyB7XG5cdGNvbnN0IGRpdmUgPSBjYXB0dXJlLmRpdmUgPz8gcmVzb2x2ZURpdmUoKTtcblx0Y29uc3QgbWF4RWRnZXMgPSBidWRnZXQubWF4RWRnZXMgPz8gREVGQVVMVF9NQVhfRURHRVM7XG5cdGNvbnN0IG1heEluc3RhbmNlcyA9IGJ1ZGdldC5tYXhJbnN0YW5jZXMgPz8gREVGQVVMVF9NQVhfSU5TVEFOQ0VTO1xuXHRjb25zdCBtZXNzYWdlID0gY2FwdHVyZS5lcnJvciBpbnN0YW5jZW9mIEVycm9yXG5cdFx0PyBjYXB0dXJlLmVycm9yLm1lc3NhZ2Vcblx0XHQ6IFN0cmluZyhjYXB0dXJlLmVycm9yKTtcblxuXHQvLyAtLS0gcGljayB0aGUgY2hhaW4gZnJvbSB0aGUgRklSU1Qgc291cmNlIHRoYXQgaGFzIG9uZVxuXHRsZXQgc291cmNlOiBFcnJvclNvdXJjZSA9ICdub25lJztcblx0bGV0IGV2aWRlbmNlID0gZmFsc2U7XG5cdGxldCBjaGFpbjogRmxvd0VkZ2VbXSA9IFtdO1xuXG5cdGlmIChjYXB0dXJlLmVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRjb25zdCBmcm9tRXJyb3IgPSBkaXZlLmdldEZsb3coY2FwdHVyZS5lcnJvcik7XG5cdFx0aWYgKGZyb21FcnJvci5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnZXJyb3InO1xuXHRcdFx0ZXZpZGVuY2UgPSB0cnVlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tRXJyb3I7XG5cdFx0fVxuXHR9XG5cdGlmIChzb3VyY2UgPT09ICdub25lJyAmJiBjYXB0dXJlLmZyYW1lRWRnZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0Ly8gdGhlIGZyYW1lIGhvbGRzIHRoZSBMSVZFIGVkZ2UgKGRpdmUncyBlbnRlciBwYXlsb2FkKSwgYWxpdmUgYXNcblx0XHQvLyBsb25nIGFzIHRoZSBmcmFtZSDigJQgZ2V0RmxvdyBjYW5ub3QgY29tZSBiYWNrIGVtcHR5IGhlcmVcblx0XHRjb25zdCBmcm9tRnJhbWUgPSBkaXZlLmdldEZsb3coY2FwdHVyZS5mcmFtZUVkZ2UpO1xuXHRcdGlmIChmcm9tRnJhbWUubGVuZ3RoID4gMCkge1xuXHRcdFx0c291cmNlID0gJ2FzeW5jLWZyYW1lJztcblx0XHRcdGV2aWRlbmNlID0gdHJ1ZTtcblx0XHRcdGNoYWluID0gZnJvbUZyYW1lO1xuXHRcdH1cblx0fVxuXHRpZiAoc291cmNlID09PSAnbm9uZScgJiYgY2FwdHVyZS5jdXJyZW50ICE9PSBudWxsKSB7XG5cdFx0Y29uc3QgZnJvbUN1cnJlbnQgPSBkaXZlLmdldEZsb3coY2FwdHVyZS5jdXJyZW50KTtcblx0XHRpZiAoZnJvbUN1cnJlbnQubGVuZ3RoID4gMCkge1xuXHRcdFx0c291cmNlID0gJ2xhc3QtY29udGV4dCc7XG5cdFx0XHRldmlkZW5jZSA9IGZhbHNlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tQ3VycmVudDtcblx0XHR9XG5cdH1cblxuXHQvLyAtLS0gYnVkZ2V0IHRoZSBjaGFpbjogdGhlIGZhaWx1cmUtcHJveGltYWwgVEFJTCBpcyBrZXB0XG5cdGNvbnN0IGVkZ2VzVHJ1bmNhdGVkID0gTWF0aC5tYXgoMCwgY2hhaW4ubGVuZ3RoIC0gbWF4RWRnZXMpO1xuXHRjb25zdCBrZXB0RWRnZXMgPSBjaGFpbi5zbGljZSgtbWF4RWRnZXMpO1xuXHRjb25zdCBlZGdlczogQW5hbHlzZWRFZGdlW10gPSBrZXB0RWRnZXMubWFwKChlZGdlKSA9PiB7XG5cdFx0Y29uc3QgYW5hbHlzZWQ6IEFuYWx5c2VkRWRnZSA9IHtcblx0XHRcdGtpbmQgICA6IGVkZ2Uua2luZCxcblx0XHRcdG5hbWUgICA6IGVkZ2UubmFtZSxcblx0XHRcdHN0YXR1cyA6IGVkZ2Uuc3RhdHVzLFxuXHRcdH07XG5cdFx0aWYgKGVkZ2UuY2FsbHNpdGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0YW5hbHlzZWQuY2FsbHNpdGUgPSBlZGdlLmNhbGxzaXRlO1xuXHRcdH1cblx0XHRyZXR1cm4gYW5hbHlzZWQ7XG5cdH0pO1xuXG5cdC8vIC0tLSB0aGUgZXJyb3IgaXRzZWxmIElTIGEgZmFpbGVkIG1uZW1vbmljYSBjb25zdHJ1Y3Rpb25cblx0bGV0IGZhaWxlZENvbnN0cnVjdGlvbjogRXJyb3JBbmFseXNpc1snZmFpbGVkQ29uc3RydWN0aW9uJ107XG5cdGlmIChpc0ZhaWxlZENvbnN0cnVjdGlvbihjYXB0dXJlLmVycm9yKSkge1xuXHRcdGNvbnN0IHByb3BzID0gZ2V0UHJvcHMoY2FwdHVyZS5lcnJvcikgYXMge1xuXHRcdFx0X190eXBlX18/OiB7IFR5cGVOYW1lPzogc3RyaW5nIH07XG5cdFx0fSB8IHVuZGVmaW5lZDtcblx0XHRjb25zdCB0eXBlTmFtZSA9IHByb3BzPy5fX3R5cGVfXz8uVHlwZU5hbWUgPz8gY2FwdHVyZS5lcnJvci5jb25zdHJ1Y3Rvci5uYW1lO1xuXHRcdGZhaWxlZENvbnN0cnVjdGlvbiA9IHtcblx0XHRcdHR5cGVOYW1lLFxuXHRcdFx0YXR0ZW1wdGVkQXJncyA6IGVycm9yZWRBcmdzU2FmZShjYXB0dXJlLmVycm9yKSxcblx0XHR9O1xuXHR9XG5cblx0Ly8gLS0tIE9ORSBsaW5lYWdlIGdyYXBoIG92ZXIgdGhlIERJU1RJTkNUIExJVkUgaW5zdGFuY2VzIG9mIHRoZSBjaGFpblxuXHRjb25zdCBzZWVuID0gbmV3IFNldDxvYmplY3Q+KCk7XG5cdGNvbnN0IGxpdmVJbnN0YW5jZXM6IG9iamVjdFtdID0gW107XG5cdGxldCBpbnN0YW5jZXNTa2lwcGVkID0gMDtcblx0Zm9yIChjb25zdCBlZGdlIG9mIGtlcHRFZGdlcykge1xuXHRcdGNvbnN0IHsgaW5zdGFuY2UgfSA9IGVkZ2U7XG5cdFx0aWYgKGluc3RhbmNlID09PSB1bmRlZmluZWQpIHtcblx0XHRcdC8vIGNvdW50IG9ubHkgaW5zdGFuY2VzIHRoYXQgV0VSRSB0aGVyZSBhbmQgZ290IGNvbGxlY3RlZDtcblx0XHRcdC8vIGVkZ2VzIHJlY29yZGVkIHdpdGhvdXQgYW4gaW5zdGFuY2UgYXJlIG5vdCBza2lwcGVkIGRhdGFcblx0XHRcdGlmIChlZGdlLmluc3RhbmNlQ29sbGVjdGVkID09PSB0cnVlKSB7XG5cdFx0XHRcdGluc3RhbmNlc1NraXBwZWQgKz0gMTtcblx0XHRcdH1cblx0XHRcdGNvbnRpbnVlO1xuXHRcdH1cblx0XHRpZiAoc2Vlbi5oYXMoaW5zdGFuY2UpKSB7XG5cdFx0XHRjb250aW51ZTtcblx0XHR9XG5cdFx0c2Vlbi5hZGQoaW5zdGFuY2UpO1xuXHRcdGxpdmVJbnN0YW5jZXMucHVzaChpbnN0YW5jZSk7XG5cdH1cblx0Y29uc3QgaW5zdGFuY2VzVHJ1bmNhdGVkID0gTWF0aC5tYXgoMCwgbGl2ZUluc3RhbmNlcy5sZW5ndGggLSBtYXhJbnN0YW5jZXMpO1xuXHRjb25zdCBrZXB0SW5zdGFuY2VzID0gbGl2ZUluc3RhbmNlcy5zbGljZSgwLCBtYXhJbnN0YW5jZXMpO1xuXHRjb25zdCBsaW5lYWdlOiBMaW5lYWdlR3JhcGggfCBudWxsID0ga2VwdEluc3RhbmNlcy5sZW5ndGggPiAwXG5cdFx0PyB1dGlscy5saW5lYWdlKGtlcHRJbnN0YW5jZXMpXG5cdFx0OiBudWxsO1xuXG5cdGNvbnN0IGFuYWx5c2lzOiBFcnJvckFuYWx5c2lzID0ge1xuXHRcdHNvdXJjZSxcblx0XHRldmlkZW5jZSxcblx0XHRtZXNzYWdlLFxuXHRcdGVkZ2VzLFxuXHRcdGVkZ2VzVHJ1bmNhdGVkLFxuXHRcdGxpbmVhZ2UsXG5cdFx0aW5zdGFuY2VzIDoga2VwdEluc3RhbmNlcy5sZW5ndGgsXG5cdFx0aW5zdGFuY2VzU2tpcHBlZCxcblx0XHRpbnN0YW5jZXNUcnVuY2F0ZWQsXG5cdH07XG5cdGlmIChmYWlsZWRDb25zdHJ1Y3Rpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdGFuYWx5c2lzLmZhaWxlZENvbnN0cnVjdGlvbiA9IGZhaWxlZENvbnN0cnVjdGlvbjtcblx0fVxuXHRyZXR1cm4gYW5hbHlzaXM7XG59XG5cbi8qKlxuICogUHV0IHRoZSBhbmFseXNpcyBvbiBhIHNwYW4gVEhFIENBTExFUiBQQVNTRVMg4oCUIG9uZSAnbW5lbW9uaWNhLmVycm9yJ1xuICogZXZlbnQ6IHRoZSBsaW5lYWdlIGdyYXBoIEpTT04gaW4gJ21uZW1vbmljYS5saW5lYWdlLmdyYXBoJywgcGx1cyB0aGVcbiAqIHNvdXJjZSBhbmQgdGhlIGV2aWRlbmNlIGZsYWcuIE5vIHNwYW4gaXMgY3JlYXRlZCBoZXJlOyBubyBzdGRvdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFcnJvckFuYWx5c2lzIChhbmFseXNpczogRXJyb3JBbmFseXNpcywgc3BhbjogU3Bhbik6IHZvaWQge1xuXHRjb25zdCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiA9IHtcblx0XHRbIEFUVFJfU09VUkNFIF0gICA6IGFuYWx5c2lzLnNvdXJjZSxcblx0XHRbIEFUVFJfRVZJREVOQ0UgXSA6IGFuYWx5c2lzLmV2aWRlbmNlLFxuXHR9O1xuXHRpZiAoYW5hbHlzaXMubGluZWFnZSAhPT0gbnVsbCkge1xuXHRcdGF0dHJpYnV0ZXNbIEFUVFJfTElORUFHRV9HUkFQSCBdID0gSlNPTi5zdHJpbmdpZnkoYW5hbHlzaXMubGluZWFnZSk7XG5cdH1cblx0c3Bhbi5hZGRFdmVudChFVkVOVF9FUlJPUiwgYXR0cmlidXRlcyk7XG59XG4iXX0=