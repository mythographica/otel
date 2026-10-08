"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureError = captureError;
exports.analyseError = analyseError;
exports.recordErrorAnalysis = recordErrorAnalysis;
/**
 * Error analysis — error → its dive edge → its instances.
 *
 * Plan: plan/boundary-cleanup.md step 1b. On uncaughtException /
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
const dive_1 = require("@mnemonica/dive");
const module_1 = require("mnemonica/module");
/** the span event and attribute names — the cross-language contract */
const EVENT_ERROR = 'mnemonica.error';
const ATTR_LINEAGE_GRAPH = 'mnemonica.lineage.graph';
const ATTR_SOURCE = 'mnemonica.error.source';
const ATTR_EVIDENCE = 'mnemonica.error.evidence';
const DEFAULT_MAX_EDGES = 32;
const DEFAULT_MAX_INSTANCES = 16;
function captureError(error, deps) {
    const frame = deps?.asyncFlow?.currentFrame();
    const capture = {
        error,
        frameInstances: frame?.instances ?? [],
        current: (0, dive_1.current)() ?? null,
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
        const fromError = (0, dive_1.getFlow)(capture.error);
        if (fromError.length > 0) {
            source = 'error';
            evidence = true;
            chain = fromError;
        }
    }
    if (source === 'none' && capture.frameEdge !== undefined) {
        // the frame holds the LIVE edge (dive's enter payload), alive as
        // long as the frame — getFlow cannot come back empty here
        const fromFrame = (0, dive_1.getFlow)(capture.frameEdge);
        if (fromFrame.length > 0) {
            source = 'async-frame';
            evidence = true;
            chain = fromFrame;
        }
    }
    if (source === 'none' && capture.current !== null) {
        const fromCurrent = (0, dive_1.getFlow)(capture.current);
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
        const instance = edge.instance;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItYW5hbHlzaXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZXJyb3ItYW5hbHlzaXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFzSEEsb0NBV0M7QUFxQkQsb0NBK0dDO0FBT0Qsa0RBU0M7QUFyUkQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUNHO0FBQ0gsMENBQW1EO0FBRW5ELDZDQUFtRDtBQVFuRCx1RUFBdUU7QUFDdkUsTUFBTSxXQUFXLEdBQUcsaUJBQWlCLENBQUM7QUFDdEMsTUFBTSxrQkFBa0IsR0FBRyx5QkFBeUIsQ0FBQztBQUNyRCxNQUFNLFdBQVcsR0FBRyx3QkFBd0IsQ0FBQztBQUM3QyxNQUFNLGFBQWEsR0FBRywwQkFBMEIsQ0FBQztBQWVqRCxNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztBQUM3QixNQUFNLHFCQUFxQixHQUFHLEVBQUUsQ0FBQztBQThDakMsU0FBZ0IsWUFBWSxDQUFFLEtBQWMsRUFBRSxJQUF3QjtJQUNyRSxNQUFNLEtBQUssR0FBRyxJQUFJLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxDQUFDO0lBQzlDLE1BQU0sT0FBTyxHQUFpQjtRQUM3QixLQUFLO1FBQ0wsY0FBYyxFQUFHLEtBQUssRUFBRSxTQUFTLElBQUksRUFBRTtRQUN2QyxPQUFPLEVBQVUsSUFBQSxjQUFPLEdBQUUsSUFBSSxJQUFJO0tBQ2xDLENBQUM7SUFDRixJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDL0IsT0FBTyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO0lBQ2hDLENBQUM7SUFDRCxPQUFPLE9BQU8sQ0FBQztBQUNoQixDQUFDO0FBRUQseUVBQXlFO0FBQ3pFLDRFQUE0RTtBQUM1RSx3RUFBd0U7QUFDeEUsTUFBTSxlQUFlLEdBQUcsQ0FBQyxLQUFZLEVBQVcsRUFBRTtJQUNqRCxJQUFJLENBQUM7UUFDSixN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UUFDakMsQ0FBQyxhQUFhLENBQUMsRUFBRyxRQUFRLENBQUMsUUFBUTtLQUNuQyxDQUFDO0lBQ0YsSUFBSSxRQUFRLENBQUMsT0FBTyxLQUFLLElBQUksRUFBRSxDQUFDO1FBQy9CLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztBQUN4QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBFcnJvciBhbmFseXNpcyDigJQgZXJyb3Ig4oaSIGl0cyBkaXZlIGVkZ2Ug4oaSIGl0cyBpbnN0YW5jZXMuXG4gKlxuICogUGxhbjogcGxhbi9ib3VuZGFyeS1jbGVhbnVwLm1kIHN0ZXAgMWIuIE9uIHVuY2F1Z2h0RXhjZXB0aW9uIC9cbiAqIHVuaGFuZGxlZFJlamVjdGlvbiB0aGVyZSBpcyBhbiBlcnJvciB0byBhbmFseXNlOyB0aGlzIG1vZHVsZSBmaW5kc1xuICogV0hJQ0ggZGl2ZSBlZGdlIGl0IGNhbWUgZnJvbSwgd2Fsa3MgdGhhdCBlZGdlJ3MgY2hhaW4sIGFuZCBjb2xsZWN0cyB0aGVcbiAqIGluc3RhbmNlcyB3aXJlZCB0byBpdCDigJQgcmV0dXJuaW5nIERBVEEsIG5ldmVyIHByaW50aW5nIGFueXRoaW5nICh0aGVcbiAqIGNhbGxlciBkZWNpZGVzIHdoYXQgdG8gbG9nOyBub3RoaW5nIGhlcmUgd3JpdGVzIHRvIHN0ZG91dCBvciBjb25zb2xlKS5cbiAqXG4gKiBUd28gcGhhc2VzLCBiZWNhdXNlIGFmdGVyIHVuY2F1Z2h0RXhjZXB0aW9uIHRoZSBwb2QgbWF5IGJlIGtpbGxlZCBhbmRcbiAqIGRlZmVycmVkIHdvcmsgbWF5IG5ldmVyIHJ1bjpcbiAqXG4gKiAtIGNhcHR1cmVFcnJvcihlcnJvciwgZGVwcz8pIOKAlCBQSEFTRSAxLCBzeW5jaHJvbm91cyBhbmQgY2hlYXA6IGtlZXBzXG4gKiAgIFJFRkVSRU5DRVMgb25seSAodGhlIGVycm9yLCB0aGUgYXN5bmMtZmxvdyBmcmFtZSdzIGVkZ2UgYW5kXG4gKiAgIHBpbm5lZCBpbnN0YW5jZXMgd2hlbiBhIHByb3ZpZGVyIGlzIGdpdmVuLCBkaXZlLmN1cnJlbnQoKSkuIE5vIHN0YWNrXG4gKiAgIHJlYWRpbmcsIG5vIGdyYXBocy5cbiAqIC0gYW5hbHlzZUVycm9yKGNhcHR1cmUsIGJ1ZGdldD8pIOKAlCBQSEFTRSAyLCBvbmx5IHdoZW4gdGhlIGNhbGxlciBhc2tzOlxuICogICBwaWNrcyB0aGUgZWRnZSBjaGFpbiBmcm9tIHRoZSBGSVJTVCBzb3VyY2UgdGhhdCBoYXMgb25lIOKAlFxuICogICAgIChhKSBnZXRGbG93KGVycm9yKSAgICAgICAgICAgICAg4oCUIHRoZSBlcnJvciB3YXMgcGlubmVkIGJ5IGRpdmUncyBvd25cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd3JhcHBlcjogRVZJREVOQ0U7XG4gKiAgICAgKGIpIGdldEZsb3coZnJhbWUuZWRnZSkgICAgICAgICDigJQgdGhlIEFMUyBmcmFtZSBhdCBjcmFzaCB0aW1lOiBhbHNvXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVWSURFTkNFIG9uIE5vZGUuIERpdmUgaGFuZHMgdGhlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIExJVkUgZWRnZSBpbiB0aGUgZW50ZXIgcGF5bG9hZCwgYW5kXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBmcmFtZSBrZWVwcyBpdCAocGx1cywgdGhyb3VnaFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXZlJ3MgcGFyZW50IGxpbmtzLCBpdHMgYW5jZXN0b3JzKVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGl2ZSBhcyBsb25nIGFzIHRoZSBzY29wZSdzIGFzeW5jXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmsgbGl2ZXMg4oCUIHRoZSBzYW1lIHdheSBhIHBlbmRpbmdcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZXIga2VlcHMgaXRzIGJyYW5jaC4gVGhlIGVkZ2VcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2Fubm90IGJlIFwiYWxyZWFkeSBjb2xsZWN0ZWRcIiB3aGlsZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgZnJhbWUgZXhpc3RzO1xuICogICAgIChjKSBnZXRGbG93KGNhcHR1cmUuY3VycmVudCkgICAg4oCUIGRpdmUncyByZXN0IHJlc2lkdWU6IGEgbGFiZWxsZWRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgR1VFU1MsIG5ldmVyIGV2aWRlbmNlO1xuICogICAgIChkKSBub25lICAgICAgICAgICAgICAgICAgICAgICAg4oCUIHNvdXJjZSAnbm9uZScuXG4gKiAgIE9uZSBjb3JlIHV0aWxzLmxpbmVhZ2UgZ3JhcGggaXMgYnVpbHQgb3ZlciB0aGUgRElTVElOQ1QgTElWRSBpbnN0YW5jZXNcbiAqICAgb2YgdGhlIGNoYWluIChjb2xsZWN0ZWQgaW5zdGFuY2VzIGFyZSBza2lwcGVkIGFuZCBjb3VudGVkKS4gQnVkZ2V0IHtcbiAqICAgbWF4RWRnZXMsIG1heEluc3RhbmNlcyB9IGJvdW5kcyB0aGUgd29yazsgZXZlcnkgdHJ1bmNhdGlvbiBpcyByZXBvcnRlZFxuICogICBpbiB0aGUgcmVzdWx0LCBuZXZlciBzaWxlbnQuXG4gKlxuICogLSByZWNvcmRFcnJvckFuYWx5c2lzKGFuYWx5c2lzLCBzcGFuKSBwdXRzIHRoZSByZXN1bHQgb24gYSBzcGFuIFRIRVxuICogICBDQUxMRVIgUEFTU0VTOiBvbmUgJ21uZW1vbmljYS5lcnJvcicgZXZlbnQgd2l0aCB0aGUgbGluZWFnZSBncmFwaCBKU09OXG4gKiAgIGluICdtbmVtb25pY2EubGluZWFnZS5ncmFwaCcgcGx1cyB0aGUgc291cmNlIGFuZCB0aGUgZXZpZGVuY2UgZmxhZy5cbiAqL1xuaW1wb3J0IHsgZ2V0RmxvdywgY3VycmVudCB9IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5pbXBvcnQgdHlwZSB7IEZsb3dFZGdlIH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB7IHV0aWxzLCBnZXRQcm9wcyB9IGZyb20gJ21uZW1vbmljYS9tb2R1bGUnO1xuaW1wb3J0IHR5cGUgeyBTcGFuIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB0eXBlIHsgQXN5bmNGbG93UHJvdmlkZXIgfSBmcm9tICcuL3Byb3ZpZGVycy9hc3luYy1mbG93LnByb3ZpZGVyLmpzJztcblxuLyoqIGNvcmUgZG9lcyBub3QgcmUtZXhwb3J0IHRoZSBMaW5lYWdlR3JhcGggbmFtZSBmcm9tIGl0cyBlbnRyeSBkLnRzIOKAlFxuICogIHRoZSBncmFwaCB0eXBlIGlzIGV4YWN0bHkgd2hhdCB1dGlscy5saW5lYWdlIHJldHVybnMgKi9cbnR5cGUgTGluZWFnZUdyYXBoID0gUmV0dXJuVHlwZTx0eXBlb2YgdXRpbHMubGluZWFnZT47XG5cbi8qKiB0aGUgc3BhbiBldmVudCBhbmQgYXR0cmlidXRlIG5hbWVzIOKAlCB0aGUgY3Jvc3MtbGFuZ3VhZ2UgY29udHJhY3QgKi9cbmNvbnN0IEVWRU5UX0VSUk9SID0gJ21uZW1vbmljYS5lcnJvcic7XG5jb25zdCBBVFRSX0xJTkVBR0VfR1JBUEggPSAnbW5lbW9uaWNhLmxpbmVhZ2UuZ3JhcGgnO1xuY29uc3QgQVRUUl9TT1VSQ0UgPSAnbW5lbW9uaWNhLmVycm9yLnNvdXJjZSc7XG5jb25zdCBBVFRSX0VWSURFTkNFID0gJ21uZW1vbmljYS5lcnJvci5ldmlkZW5jZSc7XG5cbmV4cG9ydCB0eXBlIEVycm9yU291cmNlID0gJ2Vycm9yJyB8ICdhc3luYy1mcmFtZScgfCAnbGFzdC1jb250ZXh0JyB8ICdub25lJztcblxuZXhwb3J0IGludGVyZmFjZSBFcnJvckFuYWx5c2lzRGVwcyB7XG5cdGFzeW5jRmxvdz86IEFzeW5jRmxvd1Byb3ZpZGVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuYWx5c2lzQnVkZ2V0IHtcblx0LyoqIGNoYWluIGxlbmd0aCBjYXA7IHRoZSBmYWlsdXJlLXByb3hpbWFsIFRBSUwgaXMga2VwdCAqL1xuXHRtYXhFZGdlcz8gICAgIDogbnVtYmVyO1xuXHQvKiogZGlzdGluY3QgbGl2ZSBpbnN0YW5jZXMgZmVkIGludG8gdGhlIGxpbmVhZ2UgZ3JhcGggKi9cblx0bWF4SW5zdGFuY2VzPyA6IG51bWJlcjtcbn1cblxuY29uc3QgREVGQVVMVF9NQVhfRURHRVMgPSAzMjtcbmNvbnN0IERFRkFVTFRfTUFYX0lOU1RBTkNFUyA9IDE2O1xuXG5leHBvcnQgaW50ZXJmYWNlIEFuYWx5c2VkRWRnZSB7XG5cdGtpbmQgICAgIDogc3RyaW5nO1xuXHRuYW1lICAgICA6IHN0cmluZztcblx0c3RhdHVzICAgOiBzdHJpbmc7XG5cdGNhbGxzaXRlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQW5hbHlzaXMge1xuXHRzb3VyY2UgICAgICAgICAgICAgICA6IEVycm9yU291cmNlO1xuXHRldmlkZW5jZSAgICAgICAgICAgICA6IGJvb2xlYW47XG5cdG1lc3NhZ2UgICAgICAgICAgICAgIDogc3RyaW5nO1xuXHRlZGdlcyAgICAgICAgICAgICAgICA6IEFuYWx5c2VkRWRnZVtdO1xuXHQvKiogY2hhaW4gZWRnZXMgY3V0IGJ5IG1heEVkZ2VzICh0aGUgZmFpbHVyZS1wcm94aW1hbCB0YWlsIHdhcyBrZXB0KSAqL1xuXHRlZGdlc1RydW5jYXRlZCAgICAgICA6IG51bWJlcjtcblx0LyoqIHRoZSBlcnJvciBpdHNlbGYgSVMgYSBmYWlsZWQgbW5lbW9uaWNhIGNvbnN0cnVjdGlvbiAqL1xuXHRmYWlsZWRDb25zdHJ1Y3Rpb24/ICA6IHtcblx0XHR0eXBlTmFtZSAgICAgOiBzdHJpbmc7XG5cdFx0YXR0ZW1wdGVkQXJnczogdW5rbm93bjtcblx0fTtcblx0LyoqIE9ORSBjb3JlIHV0aWxzLmxpbmVhZ2UgZ3JhcGggb3ZlciB0aGUgY2hhaW4ncyBkaXN0aW5jdCBsaXZlXG5cdCAqICBpbnN0YW5jZXM7IG51bGwgd2hlbiB0aGUgY2hhaW4gY2FycmllZCBub25lICovXG5cdGxpbmVhZ2UgICAgICAgICAgICAgIDogTGluZWFnZUdyYXBoIHwgbnVsbDtcblx0aW5zdGFuY2VzICAgICAgICAgICAgOiBudW1iZXI7XG5cdC8qKiBjaGFpbiBlZGdlcyB3aG9zZSBpbnN0YW5jZSB3YXMgYWxyZWFkeSBjb2xsZWN0ZWQg4oCUIHNraXBwZWQsIGNvdW50ZWQgKi9cblx0aW5zdGFuY2VzU2tpcHBlZCAgICAgOiBudW1iZXI7XG5cdC8qKiBsaXZlIGluc3RhbmNlcyBjdXQgYnkgbWF4SW5zdGFuY2VzIChuZXZlciBlbnRlcmVkIHRoZSBncmFwaCkgKi9cblx0aW5zdGFuY2VzVHJ1bmNhdGVkICAgOiBudW1iZXI7XG59XG5cbi8qKlxuICogUEhBU0UgMSDigJQgc3luY2hyb25vdXMgY2FwdHVyZSBvZiBSRUZFUkVOQ0VTIG9ubHkuIFNhZmUgaW5zaWRlIGFuXG4gKiB1bmNhdWdodEV4Y2VwdGlvbiBoYW5kbGVyOiBubyBzdGFjayByZWFkaW5nLCBubyBncmFwaCBidWlsZGluZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFcnJvckNhcHR1cmUge1xuXHRlcnJvciAgICAgICAgICA6IHVua25vd247XG5cdC8qKiB0aGUgQUxTIGZyYW1lJ3MgZWRnZSAodGhlIExJVkUgZWRnZSBkaXZlIGhhbmRzIGluIHRoZSBlbnRlciBwYXlsb2FkKSxcblx0ICogIHdoZW4gYSBwcm92aWRlciB3YXMgZ2l2ZW4gYXQgY2FwdHVyZSDigJQgdGhlIGZyYW1lIGtlZXBzIGl0IGFsaXZlICovXG5cdGZyYW1lRWRnZT8gICAgIDogRmxvd0VkZ2U7XG5cdC8qKiB0aGUgZnJhbWUncyBwaW5uZWQgY29udGV4dCBpbnN0YW5jZXMgKHN0cm9uZyByZWZzLCByZXF1ZXN0LWxpZmV0aW1lKSAqL1xuXHRmcmFtZUluc3RhbmNlcyA6IG9iamVjdFtdO1xuXHQvKiogZGl2ZS5jdXJyZW50KCkgYXQgY2FwdHVyZSB0aW1lIOKAlCB0aGUgcmVzdCByZXNpZHVlICovXG5cdGN1cnJlbnQgICAgICAgIDogb2JqZWN0IHwgbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVFcnJvciAoZXJyb3I6IHVua25vd24sIGRlcHM/OiBFcnJvckFuYWx5c2lzRGVwcyk6IEVycm9yQ2FwdHVyZSB7XG5cdGNvbnN0IGZyYW1lID0gZGVwcz8uYXN5bmNGbG93Py5jdXJyZW50RnJhbWUoKTtcblx0Y29uc3QgY2FwdHVyZTogRXJyb3JDYXB0dXJlID0ge1xuXHRcdGVycm9yLFxuXHRcdGZyYW1lSW5zdGFuY2VzIDogZnJhbWU/Lmluc3RhbmNlcyA/PyBbXSxcblx0XHRjdXJyZW50ICAgICAgICA6IGN1cnJlbnQoKSA/PyBudWxsLFxuXHR9O1xuXHRpZiAoZnJhbWU/LmVkZ2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdGNhcHR1cmUuZnJhbWVFZGdlID0gZnJhbWUuZWRnZTtcblx0fVxuXHRyZXR1cm4gY2FwdHVyZTtcbn1cblxuLy8gdGhlIGF0dGVtcHRlZCBjb25zdHJ1Y3RvciBhcmdzIG9mIGEgRkFJTEVEIG1uZW1vbmljYSBjb25zdHJ1Y3Rpb24gcmlkZVxuLy8gdGhlIGVycm9yZWQgc2hlbGwgaXRzZWxmOiBnZXRQcm9wcyBleHBvc2VzIHsgYXJncywgb3JpZ2luYWxFcnJvciwg4oCmIH0gb2ZmXG4vLyB0aGUgcHJvcHMgV2Vha01hcC4gRGVncmFkZXMgdG8gdW5kZWZpbmVkIOKAlCBuZXZlciB0aHJvd3Mgb24gdGhpcyBwYXRoLlxuY29uc3QgZXJyb3JlZEFyZ3NTYWZlID0gKGVycm9yOiBFcnJvcik6IHVua25vd24gPT4ge1xuXHR0cnkge1xuXHRcdGNvbnN0IHByb3BzID0gZ2V0UHJvcHMoZXJyb3IpIGFzIHsgYXJncz86IHVua25vd24gfSB8IHVuZGVmaW5lZDtcblx0XHRjb25zdCByZXN1bHQgPSBwcm9wcz8uYXJncztcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9IGNhdGNoIHtcblx0XHRjb25zdCByZXN1bHQgPSB1bmRlZmluZWQ7XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxufTtcblxuY29uc3QgaXNGYWlsZWRDb25zdHJ1Y3Rpb24gPSAoZXJyb3I6IHVua25vd24pOiBlcnJvciBpcyBFcnJvciA9PiB7XG5cdGNvbnN0IGZhaWxlZENoZWNrID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBnZXRQcm9wcyhlcnJvcikgIT09IHVuZGVmaW5lZDtcblx0cmV0dXJuIGZhaWxlZENoZWNrO1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGFuYWx5c2VFcnJvciAoXG5cdGNhcHR1cmUgIDogRXJyb3JDYXB0dXJlLFxuXHRidWRnZXQgICA6IEFuYWx5c2lzQnVkZ2V0ID0ge30sXG4pOiBFcnJvckFuYWx5c2lzIHtcblx0Y29uc3QgbWF4RWRnZXMgPSBidWRnZXQubWF4RWRnZXMgPz8gREVGQVVMVF9NQVhfRURHRVM7XG5cdGNvbnN0IG1heEluc3RhbmNlcyA9IGJ1ZGdldC5tYXhJbnN0YW5jZXMgPz8gREVGQVVMVF9NQVhfSU5TVEFOQ0VTO1xuXHRjb25zdCBtZXNzYWdlID0gY2FwdHVyZS5lcnJvciBpbnN0YW5jZW9mIEVycm9yXG5cdFx0PyBjYXB0dXJlLmVycm9yLm1lc3NhZ2Vcblx0XHQ6IFN0cmluZyhjYXB0dXJlLmVycm9yKTtcblxuXHQvLyAtLS0gcGljayB0aGUgY2hhaW4gZnJvbSB0aGUgRklSU1Qgc291cmNlIHRoYXQgaGFzIG9uZVxuXHRsZXQgc291cmNlOiBFcnJvclNvdXJjZSA9ICdub25lJztcblx0bGV0IGV2aWRlbmNlID0gZmFsc2U7XG5cdGxldCBjaGFpbjogRmxvd0VkZ2VbXSA9IFtdO1xuXG5cdGlmIChjYXB0dXJlLmVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRjb25zdCBmcm9tRXJyb3IgPSBnZXRGbG93KGNhcHR1cmUuZXJyb3IpO1xuXHRcdGlmIChmcm9tRXJyb3IubGVuZ3RoID4gMCkge1xuXHRcdFx0c291cmNlID0gJ2Vycm9yJztcblx0XHRcdGV2aWRlbmNlID0gdHJ1ZTtcblx0XHRcdGNoYWluID0gZnJvbUVycm9yO1xuXHRcdH1cblx0fVxuXHRpZiAoc291cmNlID09PSAnbm9uZScgJiYgY2FwdHVyZS5mcmFtZUVkZ2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdC8vIHRoZSBmcmFtZSBob2xkcyB0aGUgTElWRSBlZGdlIChkaXZlJ3MgZW50ZXIgcGF5bG9hZCksIGFsaXZlIGFzXG5cdFx0Ly8gbG9uZyBhcyB0aGUgZnJhbWUg4oCUIGdldEZsb3cgY2Fubm90IGNvbWUgYmFjayBlbXB0eSBoZXJlXG5cdFx0Y29uc3QgZnJvbUZyYW1lID0gZ2V0RmxvdyhjYXB0dXJlLmZyYW1lRWRnZSk7XG5cdFx0aWYgKGZyb21GcmFtZS5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnYXN5bmMtZnJhbWUnO1xuXHRcdFx0ZXZpZGVuY2UgPSB0cnVlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tRnJhbWU7XG5cdFx0fVxuXHR9XG5cdGlmIChzb3VyY2UgPT09ICdub25lJyAmJiBjYXB0dXJlLmN1cnJlbnQgIT09IG51bGwpIHtcblx0XHRjb25zdCBmcm9tQ3VycmVudCA9IGdldEZsb3coY2FwdHVyZS5jdXJyZW50KTtcblx0XHRpZiAoZnJvbUN1cnJlbnQubGVuZ3RoID4gMCkge1xuXHRcdFx0c291cmNlID0gJ2xhc3QtY29udGV4dCc7XG5cdFx0XHRldmlkZW5jZSA9IGZhbHNlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tQ3VycmVudDtcblx0XHR9XG5cdH1cblxuXHQvLyAtLS0gYnVkZ2V0IHRoZSBjaGFpbjogdGhlIGZhaWx1cmUtcHJveGltYWwgVEFJTCBpcyBrZXB0XG5cdGNvbnN0IGVkZ2VzVHJ1bmNhdGVkID0gTWF0aC5tYXgoMCwgY2hhaW4ubGVuZ3RoIC0gbWF4RWRnZXMpO1xuXHRjb25zdCBrZXB0RWRnZXMgPSBjaGFpbi5zbGljZSgtbWF4RWRnZXMpO1xuXHRjb25zdCBlZGdlczogQW5hbHlzZWRFZGdlW10gPSBrZXB0RWRnZXMubWFwKChlZGdlKSA9PiB7XG5cdFx0Y29uc3QgYW5hbHlzZWQ6IEFuYWx5c2VkRWRnZSA9IHtcblx0XHRcdGtpbmQgICA6IGVkZ2Uua2luZCxcblx0XHRcdG5hbWUgICA6IGVkZ2UubmFtZSxcblx0XHRcdHN0YXR1cyA6IGVkZ2Uuc3RhdHVzLFxuXHRcdH07XG5cdFx0aWYgKGVkZ2UuY2FsbHNpdGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdFx0YW5hbHlzZWQuY2FsbHNpdGUgPSBlZGdlLmNhbGxzaXRlO1xuXHRcdH1cblx0XHRyZXR1cm4gYW5hbHlzZWQ7XG5cdH0pO1xuXG5cdC8vIC0tLSB0aGUgZXJyb3IgaXRzZWxmIElTIGEgZmFpbGVkIG1uZW1vbmljYSBjb25zdHJ1Y3Rpb25cblx0bGV0IGZhaWxlZENvbnN0cnVjdGlvbjogRXJyb3JBbmFseXNpc1snZmFpbGVkQ29uc3RydWN0aW9uJ107XG5cdGlmIChpc0ZhaWxlZENvbnN0cnVjdGlvbihjYXB0dXJlLmVycm9yKSkge1xuXHRcdGNvbnN0IHByb3BzID0gZ2V0UHJvcHMoY2FwdHVyZS5lcnJvcikgYXMge1xuXHRcdFx0X190eXBlX18/OiB7IFR5cGVOYW1lPzogc3RyaW5nIH07XG5cdFx0fSB8IHVuZGVmaW5lZDtcblx0XHRjb25zdCB0eXBlTmFtZSA9IHByb3BzPy5fX3R5cGVfXz8uVHlwZU5hbWUgPz8gY2FwdHVyZS5lcnJvci5jb25zdHJ1Y3Rvci5uYW1lO1xuXHRcdGZhaWxlZENvbnN0cnVjdGlvbiA9IHtcblx0XHRcdHR5cGVOYW1lLFxuXHRcdFx0YXR0ZW1wdGVkQXJncyA6IGVycm9yZWRBcmdzU2FmZShjYXB0dXJlLmVycm9yKSxcblx0XHR9O1xuXHR9XG5cblx0Ly8gLS0tIE9ORSBsaW5lYWdlIGdyYXBoIG92ZXIgdGhlIERJU1RJTkNUIExJVkUgaW5zdGFuY2VzIG9mIHRoZSBjaGFpblxuXHRjb25zdCBzZWVuID0gbmV3IFNldDxvYmplY3Q+KCk7XG5cdGNvbnN0IGxpdmVJbnN0YW5jZXM6IG9iamVjdFtdID0gW107XG5cdGxldCBpbnN0YW5jZXNTa2lwcGVkID0gMDtcblx0Zm9yIChjb25zdCBlZGdlIG9mIGtlcHRFZGdlcykge1xuXHRcdGNvbnN0IGluc3RhbmNlID0gZWRnZS5pbnN0YW5jZTtcblx0XHRpZiAoaW5zdGFuY2UgPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Ly8gY291bnQgb25seSBpbnN0YW5jZXMgdGhhdCBXRVJFIHRoZXJlIGFuZCBnb3QgY29sbGVjdGVkO1xuXHRcdFx0Ly8gZWRnZXMgcmVjb3JkZWQgd2l0aG91dCBhbiBpbnN0YW5jZSBhcmUgbm90IHNraXBwZWQgZGF0YVxuXHRcdFx0aWYgKGVkZ2UuaW5zdGFuY2VDb2xsZWN0ZWQgPT09IHRydWUpIHtcblx0XHRcdFx0aW5zdGFuY2VzU2tpcHBlZCArPSAxO1xuXHRcdFx0fVxuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXHRcdGlmIChzZWVuLmhhcyhpbnN0YW5jZSkpIHtcblx0XHRcdGNvbnRpbnVlO1xuXHRcdH1cblx0XHRzZWVuLmFkZChpbnN0YW5jZSk7XG5cdFx0bGl2ZUluc3RhbmNlcy5wdXNoKGluc3RhbmNlKTtcblx0fVxuXHRjb25zdCBpbnN0YW5jZXNUcnVuY2F0ZWQgPSBNYXRoLm1heCgwLCBsaXZlSW5zdGFuY2VzLmxlbmd0aCAtIG1heEluc3RhbmNlcyk7XG5cdGNvbnN0IGtlcHRJbnN0YW5jZXMgPSBsaXZlSW5zdGFuY2VzLnNsaWNlKDAsIG1heEluc3RhbmNlcyk7XG5cdGNvbnN0IGxpbmVhZ2U6IExpbmVhZ2VHcmFwaCB8IG51bGwgPSBrZXB0SW5zdGFuY2VzLmxlbmd0aCA+IDBcblx0XHQ/IHV0aWxzLmxpbmVhZ2Uoa2VwdEluc3RhbmNlcylcblx0XHQ6IG51bGw7XG5cblx0Y29uc3QgYW5hbHlzaXM6IEVycm9yQW5hbHlzaXMgPSB7XG5cdFx0c291cmNlLFxuXHRcdGV2aWRlbmNlLFxuXHRcdG1lc3NhZ2UsXG5cdFx0ZWRnZXMsXG5cdFx0ZWRnZXNUcnVuY2F0ZWQsXG5cdFx0bGluZWFnZSxcblx0XHRpbnN0YW5jZXMgICAgICAgICAgICA6IGtlcHRJbnN0YW5jZXMubGVuZ3RoLFxuXHRcdGluc3RhbmNlc1NraXBwZWQsXG5cdFx0aW5zdGFuY2VzVHJ1bmNhdGVkLFxuXHR9O1xuXHRpZiAoZmFpbGVkQ29uc3RydWN0aW9uICE9PSB1bmRlZmluZWQpIHtcblx0XHRhbmFseXNpcy5mYWlsZWRDb25zdHJ1Y3Rpb24gPSBmYWlsZWRDb25zdHJ1Y3Rpb247XG5cdH1cblx0cmV0dXJuIGFuYWx5c2lzO1xufVxuXG4vKipcbiAqIFB1dCB0aGUgYW5hbHlzaXMgb24gYSBzcGFuIFRIRSBDQUxMRVIgUEFTU0VTIOKAlCBvbmUgJ21uZW1vbmljYS5lcnJvcidcbiAqIGV2ZW50OiB0aGUgbGluZWFnZSBncmFwaCBKU09OIGluICdtbmVtb25pY2EubGluZWFnZS5ncmFwaCcsIHBsdXMgdGhlXG4gKiBzb3VyY2UgYW5kIHRoZSBldmlkZW5jZSBmbGFnLiBObyBzcGFuIGlzIGNyZWF0ZWQgaGVyZTsgbm8gc3Rkb3V0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkRXJyb3JBbmFseXNpcyAoYW5hbHlzaXM6IEVycm9yQW5hbHlzaXMsIHNwYW46IFNwYW4pOiB2b2lkIHtcblx0Y29uc3QgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4gPSB7XG5cdFx0W0FUVFJfU09VUkNFXSAgIDogYW5hbHlzaXMuc291cmNlLFxuXHRcdFtBVFRSX0VWSURFTkNFXSA6IGFuYWx5c2lzLmV2aWRlbmNlLFxuXHR9O1xuXHRpZiAoYW5hbHlzaXMubGluZWFnZSAhPT0gbnVsbCkge1xuXHRcdGF0dHJpYnV0ZXNbQVRUUl9MSU5FQUdFX0dSQVBIXSA9IEpTT04uc3RyaW5naWZ5KGFuYWx5c2lzLmxpbmVhZ2UpO1xuXHR9XG5cdHNwYW4uYWRkRXZlbnQoRVZFTlRfRVJST1IsIGF0dHJpYnV0ZXMpO1xufVxuIl19