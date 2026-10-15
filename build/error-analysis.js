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
import { resolveDive, } from './dive-api.js';
import { utils, getProps } from 'mnemonica/module';
/** the span event and attribute names — the cross-language contract */
const EVENT_ERROR = 'mnemonica.error';
const ATTR_LINEAGE_GRAPH = 'mnemonica.lineage.graph';
const ATTR_SOURCE = 'mnemonica.error.source';
const ATTR_EVIDENCE = 'mnemonica.error.evidence';
const DEFAULT_MAX_EDGES = 32;
const DEFAULT_MAX_INSTANCES = 16;
export function captureError(error, deps) {
    const dive = resolveDive(deps);
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
        const props = getProps(error);
        const result = props?.args;
        return result;
    }
    catch {
        const result = undefined;
        return result;
    }
};
const isFailedConstruction = (error) => {
    const failedCheck = error instanceof Error && getProps(error) !== undefined;
    return failedCheck;
};
export function analyseError(capture, budget = {}) {
    const dive = capture.dive ?? resolveDive();
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
        const props = getProps(capture.error);
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
        ? utils.lineage(keptInstances)
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
export function recordErrorAnalysis(analysis, span) {
    const attributes = {
        [ATTR_SOURCE]: analysis.source,
        [ATTR_EVIDENCE]: analysis.evidence,
    };
    if (analysis.lineage !== null) {
        attributes[ATTR_LINEAGE_GRAPH] = JSON.stringify(analysis.lineage);
    }
    span.addEvent(EVENT_ERROR, attributes);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItYW5hbHlzaXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZXJyb3ItYW5hbHlzaXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUNHO0FBQ0gsT0FBTyxFQUNOLFdBQVcsR0FFWCxNQUFNLGVBQWUsQ0FBQztBQUV2QixPQUFPLEVBQ04sS0FBSyxFQUFFLFFBQVEsRUFDZixNQUFNLGtCQUFrQixDQUFDO0FBUTFCLHVFQUF1RTtBQUN2RSxNQUFNLFdBQVcsR0FBRyxpQkFBaUIsQ0FBQztBQUN0QyxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDO0FBQ3JELE1BQU0sV0FBVyxHQUFHLHdCQUF3QixDQUFDO0FBQzdDLE1BQU0sYUFBYSxHQUFHLDBCQUEwQixDQUFDO0FBa0JqRCxNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztBQUM3QixNQUFNLHFCQUFxQixHQUFHLEVBQUUsQ0FBQztBQWtEakMsTUFBTSxVQUFVLFlBQVksQ0FBRSxLQUFjLEVBQUUsSUFBd0I7SUFDckUsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9CLE1BQU0sS0FBSyxHQUFHLElBQUksRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLENBQUM7SUFDOUMsTUFBTSxPQUFPLEdBQWlCO1FBQzdCLEtBQUs7UUFDTCxjQUFjLEVBQUcsS0FBSyxFQUFFLFNBQVMsSUFBSSxFQUFFO1FBQ3ZDLE9BQU8sRUFBVSxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksSUFBSTtRQUN2QyxJQUFJO0tBQ0osQ0FBQztJQUNGLElBQUksS0FBSyxFQUFFLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixPQUFPLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7SUFDaEMsQ0FBQztJQUNELE9BQU8sT0FBTyxDQUFDO0FBQ2hCLENBQUM7QUFFRCx5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LENBQUM7SUFDRCxPQUFPLFFBQVEsQ0FBQztBQUNqQixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxtQkFBbUIsQ0FBRSxRQUF1QixFQUFFLElBQVU7SUFDdkUsTUFBTSxVQUFVLEdBQXFDO1FBQ3BELENBQUUsV0FBVyxDQUFFLEVBQUssUUFBUSxDQUFDLE1BQU07UUFDbkMsQ0FBRSxhQUFhLENBQUUsRUFBRyxRQUFRLENBQUMsUUFBUTtLQUNyQyxDQUFDO0lBQ0YsSUFBSSxRQUFRLENBQUMsT0FBTyxLQUFLLElBQUksRUFBRSxDQUFDO1FBQy9CLFVBQVUsQ0FBRSxrQkFBa0IsQ0FBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztBQUN4QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBFcnJvciBhbmFseXNpcyDigJQgZXJyb3Ig4oaSIGl0cyBkaXZlIGVkZ2Ug4oaSIGl0cyBpbnN0YW5jZXMuXG4gKlxuICogT24gdW5jYXVnaHRFeGNlcHRpb24gL1xuICogdW5oYW5kbGVkUmVqZWN0aW9uIHRoZXJlIGlzIGFuIGVycm9yIHRvIGFuYWx5c2U7IHRoaXMgbW9kdWxlIGZpbmRzXG4gKiBXSElDSCBkaXZlIGVkZ2UgaXQgY2FtZSBmcm9tLCB3YWxrcyB0aGF0IGVkZ2UncyBjaGFpbiwgYW5kIGNvbGxlY3RzIHRoZVxuICogaW5zdGFuY2VzIHdpcmVkIHRvIGl0IOKAlCByZXR1cm5pbmcgREFUQSwgbmV2ZXIgcHJpbnRpbmcgYW55dGhpbmcgKHRoZVxuICogY2FsbGVyIGRlY2lkZXMgd2hhdCB0byBsb2c7IG5vdGhpbmcgaGVyZSB3cml0ZXMgdG8gc3Rkb3V0IG9yIGNvbnNvbGUpLlxuICpcbiAqIFR3byBwaGFzZXMsIGJlY2F1c2UgYWZ0ZXIgdW5jYXVnaHRFeGNlcHRpb24gdGhlIHBvZCBtYXkgYmUga2lsbGVkIGFuZFxuICogZGVmZXJyZWQgd29yayBtYXkgbmV2ZXIgcnVuOlxuICpcbiAqIC0gY2FwdHVyZUVycm9yKGVycm9yLCBkZXBzPykg4oCUIFBIQVNFIDEsIHN5bmNocm9ub3VzIGFuZCBjaGVhcDoga2VlcHNcbiAqICAgUkVGRVJFTkNFUyBvbmx5ICh0aGUgZXJyb3IsIHRoZSBhc3luYy1mbG93IGZyYW1lJ3MgZWRnZSBhbmRcbiAqICAgcGlubmVkIGluc3RhbmNlcyB3aGVuIGEgcHJvdmlkZXIgaXMgZ2l2ZW4sIGRpdmUuY3VycmVudCgpKS4gTm8gc3RhY2tcbiAqICAgcmVhZGluZywgbm8gZ3JhcGhzLlxuICogLSBhbmFseXNlRXJyb3IoY2FwdHVyZSwgYnVkZ2V0Pykg4oCUIFBIQVNFIDIsIG9ubHkgd2hlbiB0aGUgY2FsbGVyIGFza3M6XG4gKiAgIHBpY2tzIHRoZSBlZGdlIGNoYWluIGZyb20gdGhlIEZJUlNUIHNvdXJjZSB0aGF0IGhhcyBvbmUg4oCUXG4gKiAgICAgKGEpIGdldEZsb3coZXJyb3IpICAgICAgICAgICAgICDigJQgdGhlIGVycm9yIHdhcyBwaW5uZWQgYnkgZGl2ZSdzIG93blxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3cmFwcGVyOiBFVklERU5DRTtcbiAqICAgICAoYikgZ2V0RmxvdyhmcmFtZS5lZGdlKSAgICAgICAgIOKAlCB0aGUgQUxTIGZyYW1lIGF0IGNyYXNoIHRpbWU6IGFsc29cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRVZJREVOQ0Ugb24gTm9kZS4gRGl2ZSBoYW5kcyB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTElWRSBlZGdlIGluIHRoZSBlbnRlciBwYXlsb2FkLCBhbmRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGZyYW1lIGtlZXBzIGl0IChwbHVzLCB0aHJvdWdoXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRpdmUncyBwYXJlbnQgbGlua3MsIGl0cyBhbmNlc3RvcnMpXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsaXZlIGFzIGxvbmcgYXMgdGhlIHNjb3BlJ3MgYXN5bmNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd29yayBsaXZlcyDigJQgdGhlIHNhbWUgd2F5IGEgcGVuZGluZ1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lciBrZWVwcyBpdHMgYnJhbmNoLiBUaGUgZWRnZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5ub3QgYmUgXCJhbHJlYWR5IGNvbGxlY3RlZFwiIHdoaWxlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBmcmFtZSBleGlzdHM7XG4gKiAgICAgKGMpIGdldEZsb3coY2FwdHVyZS5jdXJyZW50KSAgICDigJQgZGl2ZSdzIHJlc3QgcmVzaWR1ZTogYSBsYWJlbGxlZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBHVUVTUywgbmV2ZXIgZXZpZGVuY2U7XG4gKiAgICAgKGQpIG5vbmUgICAgICAgICAgICAgICAgICAgICAgICDigJQgc291cmNlICdub25lJy5cbiAqICAgT25lIGNvcmUgdXRpbHMubGluZWFnZSBncmFwaCBpcyBidWlsdCBvdmVyIHRoZSBESVNUSU5DVCBMSVZFIGluc3RhbmNlc1xuICogICBvZiB0aGUgY2hhaW4gKGNvbGxlY3RlZCBpbnN0YW5jZXMgYXJlIHNraXBwZWQgYW5kIGNvdW50ZWQpLiBCdWRnZXQge1xuICogICBtYXhFZGdlcywgbWF4SW5zdGFuY2VzIH0gYm91bmRzIHRoZSB3b3JrOyBldmVyeSB0cnVuY2F0aW9uIGlzIHJlcG9ydGVkXG4gKiAgIGluIHRoZSByZXN1bHQsIG5ldmVyIHNpbGVudC5cbiAqXG4gKiAtIHJlY29yZEVycm9yQW5hbHlzaXMoYW5hbHlzaXMsIHNwYW4pIHB1dHMgdGhlIHJlc3VsdCBvbiBhIHNwYW4gVEhFXG4gKiAgIENBTExFUiBQQVNTRVM6IG9uZSAnbW5lbW9uaWNhLmVycm9yJyBldmVudCB3aXRoIHRoZSBsaW5lYWdlIGdyYXBoIEpTT05cbiAqICAgaW4gJ21uZW1vbmljYS5saW5lYWdlLmdyYXBoJyBwbHVzIHRoZSBzb3VyY2UgYW5kIHRoZSBldmlkZW5jZSBmbGFnLlxuICovXG5pbXBvcnQge1xuXHRyZXNvbHZlRGl2ZSxcblx0dHlwZSBEaXZlQXBpLFxufSBmcm9tICcuL2RpdmUtYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgRmxvd0VkZ2UgfSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuaW1wb3J0IHtcblx0dXRpbHMsIGdldFByb3BzIFxufSBmcm9tICdtbmVtb25pY2EvbW9kdWxlJztcbmltcG9ydCB0eXBlIHsgU3BhbiB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQgdHlwZSB7IEFzeW5jRmxvd1Byb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci5qcyc7XG5cbi8qKiBjb3JlIGRvZXMgbm90IHJlLWV4cG9ydCB0aGUgTGluZWFnZUdyYXBoIG5hbWUgZnJvbSBpdHMgZW50cnkgZC50cyDigJRcbiAqICB0aGUgZ3JhcGggdHlwZSBpcyBleGFjdGx5IHdoYXQgdXRpbHMubGluZWFnZSByZXR1cm5zICovXG50eXBlIExpbmVhZ2VHcmFwaCA9IFJldHVyblR5cGU8dHlwZW9mIHV0aWxzLmxpbmVhZ2U+O1xuXG4vKiogdGhlIHNwYW4gZXZlbnQgYW5kIGF0dHJpYnV0ZSBuYW1lcyDigJQgdGhlIGNyb3NzLWxhbmd1YWdlIGNvbnRyYWN0ICovXG5jb25zdCBFVkVOVF9FUlJPUiA9ICdtbmVtb25pY2EuZXJyb3InO1xuY29uc3QgQVRUUl9MSU5FQUdFX0dSQVBIID0gJ21uZW1vbmljYS5saW5lYWdlLmdyYXBoJztcbmNvbnN0IEFUVFJfU09VUkNFID0gJ21uZW1vbmljYS5lcnJvci5zb3VyY2UnO1xuY29uc3QgQVRUUl9FVklERU5DRSA9ICdtbmVtb25pY2EuZXJyb3IuZXZpZGVuY2UnO1xuXG5leHBvcnQgdHlwZSBFcnJvclNvdXJjZSA9ICdlcnJvcicgfCAnYXN5bmMtZnJhbWUnIHwgJ2xhc3QtY29udGV4dCcgfCAnbm9uZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JBbmFseXNpc0RlcHMge1xuXHRhc3luY0Zsb3c/OiBBc3luY0Zsb3dQcm92aWRlcjtcblx0LyoqIHRoZSBkaXZlIHRvIHJlYWQgdGhlIHRyYWNlIGZyb20g4oCUIHRoZSBkZWZhdWx0IGRpdmUgdW5sZXNzIHRoZSBjYWxsZXJcblx0ICogIHRyYWNlcyB0aHJvdWdoIHRoZWlyIG93biAqL1xuXHRkaXZlPzogRGl2ZUFwaTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBbmFseXNpc0J1ZGdldCB7XG5cdC8qKiBjaGFpbiBsZW5ndGggY2FwOyB0aGUgZmFpbHVyZS1wcm94aW1hbCBUQUlMIGlzIGtlcHQgKi9cblx0bWF4RWRnZXM/ICAgICA6IG51bWJlcjtcblx0LyoqIGRpc3RpbmN0IGxpdmUgaW5zdGFuY2VzIGZlZCBpbnRvIHRoZSBsaW5lYWdlIGdyYXBoICovXG5cdG1heEluc3RhbmNlcz8gOiBudW1iZXI7XG59XG5cbmNvbnN0IERFRkFVTFRfTUFYX0VER0VTID0gMzI7XG5jb25zdCBERUZBVUxUX01BWF9JTlNUQU5DRVMgPSAxNjtcblxuZXhwb3J0IGludGVyZmFjZSBBbmFseXNlZEVkZ2Uge1xuXHRraW5kICAgICA6IHN0cmluZztcblx0bmFtZSAgICAgOiBzdHJpbmc7XG5cdHN0YXR1cyAgIDogc3RyaW5nO1xuXHRjYWxsc2l0ZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFcnJvckFuYWx5c2lzIHtcblx0c291cmNlICAgICAgICAgICAgICAgOiBFcnJvclNvdXJjZTtcblx0ZXZpZGVuY2UgICAgICAgICAgICAgOiBib29sZWFuO1xuXHRtZXNzYWdlICAgICAgICAgICAgICA6IHN0cmluZztcblx0ZWRnZXMgICAgICAgICAgICAgICAgOiBBbmFseXNlZEVkZ2VbXTtcblx0LyoqIGNoYWluIGVkZ2VzIGN1dCBieSBtYXhFZGdlcyAodGhlIGZhaWx1cmUtcHJveGltYWwgdGFpbCB3YXMga2VwdCkgKi9cblx0ZWRnZXNUcnVuY2F0ZWQgICAgICAgOiBudW1iZXI7XG5cdC8qKiB0aGUgZXJyb3IgaXRzZWxmIElTIGEgZmFpbGVkIG1uZW1vbmljYSBjb25zdHJ1Y3Rpb24gKi9cblx0ZmFpbGVkQ29uc3RydWN0aW9uPyAgOiB7XG5cdFx0dHlwZU5hbWUgICAgIDogc3RyaW5nO1xuXHRcdGF0dGVtcHRlZEFyZ3M6IHVua25vd247XG5cdH07XG5cdC8qKiBPTkUgY29yZSB1dGlscy5saW5lYWdlIGdyYXBoIG92ZXIgdGhlIGNoYWluJ3MgZGlzdGluY3QgbGl2ZVxuXHQgKiAgaW5zdGFuY2VzOyBudWxsIHdoZW4gdGhlIGNoYWluIGNhcnJpZWQgbm9uZSAqL1xuXHRsaW5lYWdlICAgICAgICAgICAgICA6IExpbmVhZ2VHcmFwaCB8IG51bGw7XG5cdGluc3RhbmNlcyAgICAgICAgICAgIDogbnVtYmVyO1xuXHQvKiogY2hhaW4gZWRnZXMgd2hvc2UgaW5zdGFuY2Ugd2FzIGFscmVhZHkgY29sbGVjdGVkIOKAlCBza2lwcGVkLCBjb3VudGVkICovXG5cdGluc3RhbmNlc1NraXBwZWQgICAgIDogbnVtYmVyO1xuXHQvKiogbGl2ZSBpbnN0YW5jZXMgY3V0IGJ5IG1heEluc3RhbmNlcyAobmV2ZXIgZW50ZXJlZCB0aGUgZ3JhcGgpICovXG5cdGluc3RhbmNlc1RydW5jYXRlZCAgIDogbnVtYmVyO1xufVxuXG4vKipcbiAqIFBIQVNFIDEg4oCUIHN5bmNocm9ub3VzIGNhcHR1cmUgb2YgUkVGRVJFTkNFUyBvbmx5LiBTYWZlIGluc2lkZSBhblxuICogdW5jYXVnaHRFeGNlcHRpb24gaGFuZGxlcjogbm8gc3RhY2sgcmVhZGluZywgbm8gZ3JhcGggYnVpbGRpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JDYXB0dXJlIHtcblx0ZXJyb3IgICAgICAgICAgOiB1bmtub3duO1xuXHQvKiogdGhlIEFMUyBmcmFtZSdzIGVkZ2UgKHRoZSBMSVZFIGVkZ2UgZGl2ZSBoYW5kcyBpbiB0aGUgZW50ZXIgcGF5bG9hZCksXG5cdCAqICB3aGVuIGEgcHJvdmlkZXIgd2FzIGdpdmVuIGF0IGNhcHR1cmUg4oCUIHRoZSBmcmFtZSBrZWVwcyBpdCBhbGl2ZSAqL1xuXHRmcmFtZUVkZ2U/ICAgICA6IEZsb3dFZGdlO1xuXHQvKiogdGhlIGZyYW1lJ3MgcGlubmVkIGNvbnRleHQgaW5zdGFuY2VzIChzdHJvbmcgcmVmcywgcmVxdWVzdC1saWZldGltZSkgKi9cblx0ZnJhbWVJbnN0YW5jZXMgOiBvYmplY3RbXTtcblx0LyoqIGRpdmUuY3VycmVudCgpIGF0IGNhcHR1cmUgdGltZSDigJQgdGhlIHJlc3QgcmVzaWR1ZSAqL1xuXHRjdXJyZW50ICAgICAgICA6IG9iamVjdCB8IG51bGw7XG5cdC8qKiB0aGUgZGl2ZSB0aGUgdHJhY2UgaXMgcmVhZCBmcm9tIGF0IGFuYWx5c2UgdGltZSDigJQgcmVzb2x2ZWQgYXRcblx0ICogIGNhcHR1cmUgKHRoZSBkZWZhdWx0IGRpdmUgd2hlbiBub25lIHdhcyBnaXZlbikgc28gdGhlIGNhcHR1cmUgYWxvbmVcblx0ICogIGlzIGVub3VnaCBmb3IgYW5hbHlzZUVycm9yICovXG5cdGRpdmU/ICAgICAgICAgIDogRGl2ZUFwaTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVFcnJvciAoZXJyb3I6IHVua25vd24sIGRlcHM/OiBFcnJvckFuYWx5c2lzRGVwcyk6IEVycm9yQ2FwdHVyZSB7XG5cdGNvbnN0IGRpdmUgPSByZXNvbHZlRGl2ZShkZXBzKTtcblx0Y29uc3QgZnJhbWUgPSBkZXBzPy5hc3luY0Zsb3c/LmN1cnJlbnRGcmFtZSgpO1xuXHRjb25zdCBjYXB0dXJlOiBFcnJvckNhcHR1cmUgPSB7XG5cdFx0ZXJyb3IsXG5cdFx0ZnJhbWVJbnN0YW5jZXMgOiBmcmFtZT8uaW5zdGFuY2VzID8/IFtdLFxuXHRcdGN1cnJlbnQgICAgICAgIDogZGl2ZS5jdXJyZW50KCkgPz8gbnVsbCxcblx0XHRkaXZlLFxuXHR9O1xuXHRpZiAoZnJhbWU/LmVkZ2UgIT09IHVuZGVmaW5lZCkge1xuXHRcdGNhcHR1cmUuZnJhbWVFZGdlID0gZnJhbWUuZWRnZTtcblx0fVxuXHRyZXR1cm4gY2FwdHVyZTtcbn1cblxuLy8gdGhlIGF0dGVtcHRlZCBjb25zdHJ1Y3RvciBhcmdzIG9mIGEgRkFJTEVEIG1uZW1vbmljYSBjb25zdHJ1Y3Rpb24gcmlkZVxuLy8gdGhlIGVycm9yZWQgc2hlbGwgaXRzZWxmOiBnZXRQcm9wcyBleHBvc2VzIHsgYXJncywgb3JpZ2luYWxFcnJvciwg4oCmIH0gb2ZmXG4vLyB0aGUgcHJvcHMgV2Vha01hcC4gRGVncmFkZXMgdG8gdW5kZWZpbmVkIOKAlCBuZXZlciB0aHJvd3Mgb24gdGhpcyBwYXRoLlxuY29uc3QgZXJyb3JlZEFyZ3NTYWZlID0gKGVycm9yOiBFcnJvcik6IHVua25vd24gPT4ge1xuXHR0cnkge1xuXHRcdGNvbnN0IHByb3BzID0gZ2V0UHJvcHMoZXJyb3IpIGFzIHsgYXJncz86IHVua25vd24gfSB8IHVuZGVmaW5lZDtcblx0XHRjb25zdCByZXN1bHQgPSBwcm9wcz8uYXJncztcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9IGNhdGNoIHtcblx0XHRjb25zdCByZXN1bHQgPSB1bmRlZmluZWQ7XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxufTtcblxuY29uc3QgaXNGYWlsZWRDb25zdHJ1Y3Rpb24gPSAoZXJyb3I6IHVua25vd24pOiBlcnJvciBpcyBFcnJvciA9PiB7XG5cdGNvbnN0IGZhaWxlZENoZWNrID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBnZXRQcm9wcyhlcnJvcikgIT09IHVuZGVmaW5lZDtcblx0cmV0dXJuIGZhaWxlZENoZWNrO1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGFuYWx5c2VFcnJvciAoXG5cdGNhcHR1cmUgIDogRXJyb3JDYXB0dXJlLFxuXHRidWRnZXQgICA6IEFuYWx5c2lzQnVkZ2V0ID0ge30sXG4pOiBFcnJvckFuYWx5c2lzIHtcblx0Y29uc3QgZGl2ZSA9IGNhcHR1cmUuZGl2ZSA/PyByZXNvbHZlRGl2ZSgpO1xuXHRjb25zdCBtYXhFZGdlcyA9IGJ1ZGdldC5tYXhFZGdlcyA/PyBERUZBVUxUX01BWF9FREdFUztcblx0Y29uc3QgbWF4SW5zdGFuY2VzID0gYnVkZ2V0Lm1heEluc3RhbmNlcyA/PyBERUZBVUxUX01BWF9JTlNUQU5DRVM7XG5cdGNvbnN0IG1lc3NhZ2UgPSBjYXB0dXJlLmVycm9yIGluc3RhbmNlb2YgRXJyb3Jcblx0XHQ/IGNhcHR1cmUuZXJyb3IubWVzc2FnZVxuXHRcdDogU3RyaW5nKGNhcHR1cmUuZXJyb3IpO1xuXG5cdC8vIC0tLSBwaWNrIHRoZSBjaGFpbiBmcm9tIHRoZSBGSVJTVCBzb3VyY2UgdGhhdCBoYXMgb25lXG5cdGxldCBzb3VyY2U6IEVycm9yU291cmNlID0gJ25vbmUnO1xuXHRsZXQgZXZpZGVuY2UgPSBmYWxzZTtcblx0bGV0IGNoYWluOiBGbG93RWRnZVtdID0gW107XG5cblx0aWYgKGNhcHR1cmUuZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuXHRcdGNvbnN0IGZyb21FcnJvciA9IGRpdmUuZ2V0RmxvdyhjYXB0dXJlLmVycm9yKTtcblx0XHRpZiAoZnJvbUVycm9yLmxlbmd0aCA+IDApIHtcblx0XHRcdHNvdXJjZSA9ICdlcnJvcic7XG5cdFx0XHRldmlkZW5jZSA9IHRydWU7XG5cdFx0XHRjaGFpbiA9IGZyb21FcnJvcjtcblx0XHR9XG5cdH1cblx0aWYgKHNvdXJjZSA9PT0gJ25vbmUnICYmIGNhcHR1cmUuZnJhbWVFZGdlICE9PSB1bmRlZmluZWQpIHtcblx0XHQvLyB0aGUgZnJhbWUgaG9sZHMgdGhlIExJVkUgZWRnZSAoZGl2ZSdzIGVudGVyIHBheWxvYWQpLCBhbGl2ZSBhc1xuXHRcdC8vIGxvbmcgYXMgdGhlIGZyYW1lIOKAlCBnZXRGbG93IGNhbm5vdCBjb21lIGJhY2sgZW1wdHkgaGVyZVxuXHRcdGNvbnN0IGZyb21GcmFtZSA9IGRpdmUuZ2V0RmxvdyhjYXB0dXJlLmZyYW1lRWRnZSk7XG5cdFx0aWYgKGZyb21GcmFtZS5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnYXN5bmMtZnJhbWUnO1xuXHRcdFx0ZXZpZGVuY2UgPSB0cnVlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tRnJhbWU7XG5cdFx0fVxuXHR9XG5cdGlmIChzb3VyY2UgPT09ICdub25lJyAmJiBjYXB0dXJlLmN1cnJlbnQgIT09IG51bGwpIHtcblx0XHRjb25zdCBmcm9tQ3VycmVudCA9IGRpdmUuZ2V0RmxvdyhjYXB0dXJlLmN1cnJlbnQpO1xuXHRcdGlmIChmcm9tQ3VycmVudC5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnbGFzdC1jb250ZXh0Jztcblx0XHRcdGV2aWRlbmNlID0gZmFsc2U7XG5cdFx0XHRjaGFpbiA9IGZyb21DdXJyZW50O1xuXHRcdH1cblx0fVxuXG5cdC8vIC0tLSBidWRnZXQgdGhlIGNoYWluOiB0aGUgZmFpbHVyZS1wcm94aW1hbCBUQUlMIGlzIGtlcHRcblx0Y29uc3QgZWRnZXNUcnVuY2F0ZWQgPSBNYXRoLm1heCgwLCBjaGFpbi5sZW5ndGggLSBtYXhFZGdlcyk7XG5cdGNvbnN0IGtlcHRFZGdlcyA9IGNoYWluLnNsaWNlKC1tYXhFZGdlcyk7XG5cdGNvbnN0IGVkZ2VzOiBBbmFseXNlZEVkZ2VbXSA9IGtlcHRFZGdlcy5tYXAoKGVkZ2UpID0+IHtcblx0XHRjb25zdCBhbmFseXNlZDogQW5hbHlzZWRFZGdlID0ge1xuXHRcdFx0a2luZCAgIDogZWRnZS5raW5kLFxuXHRcdFx0bmFtZSAgIDogZWRnZS5uYW1lLFxuXHRcdFx0c3RhdHVzIDogZWRnZS5zdGF0dXMsXG5cdFx0fTtcblx0XHRpZiAoZWRnZS5jYWxsc2l0ZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRhbmFseXNlZC5jYWxsc2l0ZSA9IGVkZ2UuY2FsbHNpdGU7XG5cdFx0fVxuXHRcdHJldHVybiBhbmFseXNlZDtcblx0fSk7XG5cblx0Ly8gLS0tIHRoZSBlcnJvciBpdHNlbGYgSVMgYSBmYWlsZWQgbW5lbW9uaWNhIGNvbnN0cnVjdGlvblxuXHRsZXQgZmFpbGVkQ29uc3RydWN0aW9uOiBFcnJvckFuYWx5c2lzWydmYWlsZWRDb25zdHJ1Y3Rpb24nXTtcblx0aWYgKGlzRmFpbGVkQ29uc3RydWN0aW9uKGNhcHR1cmUuZXJyb3IpKSB7XG5cdFx0Y29uc3QgcHJvcHMgPSBnZXRQcm9wcyhjYXB0dXJlLmVycm9yKSBhcyB7XG5cdFx0XHRfX3R5cGVfXz86IHsgVHlwZU5hbWU/OiBzdHJpbmcgfTtcblx0XHR9IHwgdW5kZWZpbmVkO1xuXHRcdGNvbnN0IHR5cGVOYW1lID0gcHJvcHM/Ll9fdHlwZV9fPy5UeXBlTmFtZSA/PyBjYXB0dXJlLmVycm9yLmNvbnN0cnVjdG9yLm5hbWU7XG5cdFx0ZmFpbGVkQ29uc3RydWN0aW9uID0ge1xuXHRcdFx0dHlwZU5hbWUsXG5cdFx0XHRhdHRlbXB0ZWRBcmdzIDogZXJyb3JlZEFyZ3NTYWZlKGNhcHR1cmUuZXJyb3IpLFxuXHRcdH07XG5cdH1cblxuXHQvLyAtLS0gT05FIGxpbmVhZ2UgZ3JhcGggb3ZlciB0aGUgRElTVElOQ1QgTElWRSBpbnN0YW5jZXMgb2YgdGhlIGNoYWluXG5cdGNvbnN0IHNlZW4gPSBuZXcgU2V0PG9iamVjdD4oKTtcblx0Y29uc3QgbGl2ZUluc3RhbmNlczogb2JqZWN0W10gPSBbXTtcblx0bGV0IGluc3RhbmNlc1NraXBwZWQgPSAwO1xuXHRmb3IgKGNvbnN0IGVkZ2Ugb2Yga2VwdEVkZ2VzKSB7XG5cdFx0Y29uc3QgeyBpbnN0YW5jZSB9ID0gZWRnZTtcblx0XHRpZiAoaW5zdGFuY2UgPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0Ly8gY291bnQgb25seSBpbnN0YW5jZXMgdGhhdCBXRVJFIHRoZXJlIGFuZCBnb3QgY29sbGVjdGVkO1xuXHRcdFx0Ly8gZWRnZXMgcmVjb3JkZWQgd2l0aG91dCBhbiBpbnN0YW5jZSBhcmUgbm90IHNraXBwZWQgZGF0YVxuXHRcdFx0aWYgKGVkZ2UuaW5zdGFuY2VDb2xsZWN0ZWQgPT09IHRydWUpIHtcblx0XHRcdFx0aW5zdGFuY2VzU2tpcHBlZCArPSAxO1xuXHRcdFx0fVxuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXHRcdGlmIChzZWVuLmhhcyhpbnN0YW5jZSkpIHtcblx0XHRcdGNvbnRpbnVlO1xuXHRcdH1cblx0XHRzZWVuLmFkZChpbnN0YW5jZSk7XG5cdFx0bGl2ZUluc3RhbmNlcy5wdXNoKGluc3RhbmNlKTtcblx0fVxuXHRjb25zdCBpbnN0YW5jZXNUcnVuY2F0ZWQgPSBNYXRoLm1heCgwLCBsaXZlSW5zdGFuY2VzLmxlbmd0aCAtIG1heEluc3RhbmNlcyk7XG5cdGNvbnN0IGtlcHRJbnN0YW5jZXMgPSBsaXZlSW5zdGFuY2VzLnNsaWNlKDAsIG1heEluc3RhbmNlcyk7XG5cdGNvbnN0IGxpbmVhZ2U6IExpbmVhZ2VHcmFwaCB8IG51bGwgPSBrZXB0SW5zdGFuY2VzLmxlbmd0aCA+IDBcblx0XHQ/IHV0aWxzLmxpbmVhZ2Uoa2VwdEluc3RhbmNlcylcblx0XHQ6IG51bGw7XG5cblx0Y29uc3QgYW5hbHlzaXM6IEVycm9yQW5hbHlzaXMgPSB7XG5cdFx0c291cmNlLFxuXHRcdGV2aWRlbmNlLFxuXHRcdG1lc3NhZ2UsXG5cdFx0ZWRnZXMsXG5cdFx0ZWRnZXNUcnVuY2F0ZWQsXG5cdFx0bGluZWFnZSxcblx0XHRpbnN0YW5jZXMgOiBrZXB0SW5zdGFuY2VzLmxlbmd0aCxcblx0XHRpbnN0YW5jZXNTa2lwcGVkLFxuXHRcdGluc3RhbmNlc1RydW5jYXRlZCxcblx0fTtcblx0aWYgKGZhaWxlZENvbnN0cnVjdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0YW5hbHlzaXMuZmFpbGVkQ29uc3RydWN0aW9uID0gZmFpbGVkQ29uc3RydWN0aW9uO1xuXHR9XG5cdHJldHVybiBhbmFseXNpcztcbn1cblxuLyoqXG4gKiBQdXQgdGhlIGFuYWx5c2lzIG9uIGEgc3BhbiBUSEUgQ0FMTEVSIFBBU1NFUyDigJQgb25lICdtbmVtb25pY2EuZXJyb3InXG4gKiBldmVudDogdGhlIGxpbmVhZ2UgZ3JhcGggSlNPTiBpbiAnbW5lbW9uaWNhLmxpbmVhZ2UuZ3JhcGgnLCBwbHVzIHRoZVxuICogc291cmNlIGFuZCB0aGUgZXZpZGVuY2UgZmxhZy4gTm8gc3BhbiBpcyBjcmVhdGVkIGhlcmU7IG5vIHN0ZG91dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZEVycm9yQW5hbHlzaXMgKGFuYWx5c2lzOiBFcnJvckFuYWx5c2lzLCBzcGFuOiBTcGFuKTogdm9pZCB7XG5cdGNvbnN0IGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+ID0ge1xuXHRcdFsgQVRUUl9TT1VSQ0UgXSAgIDogYW5hbHlzaXMuc291cmNlLFxuXHRcdFsgQVRUUl9FVklERU5DRSBdIDogYW5hbHlzaXMuZXZpZGVuY2UsXG5cdH07XG5cdGlmIChhbmFseXNpcy5saW5lYWdlICE9PSBudWxsKSB7XG5cdFx0YXR0cmlidXRlc1sgQVRUUl9MSU5FQUdFX0dSQVBIIF0gPSBKU09OLnN0cmluZ2lmeShhbmFseXNpcy5saW5lYWdlKTtcblx0fVxuXHRzcGFuLmFkZEV2ZW50KEVWRU5UX0VSUk9SLCBhdHRyaWJ1dGVzKTtcbn1cbiJdfQ==