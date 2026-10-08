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
import { getFlow, current } from '@mnemonica/dive';
import { utils, getProps } from 'mnemonica/module';
/** the span event and attribute names — the cross-language contract */
const EVENT_ERROR = 'mnemonica.error';
const ATTR_LINEAGE_GRAPH = 'mnemonica.lineage.graph';
const ATTR_SOURCE = 'mnemonica.error.source';
const ATTR_EVIDENCE = 'mnemonica.error.evidence';
const DEFAULT_MAX_EDGES = 32;
const DEFAULT_MAX_INSTANCES = 16;
export function captureError(error, deps) {
    const frame = deps?.asyncFlow?.currentFrame();
    const capture = {
        error,
        frameInstances: frame?.instances ?? [],
        current: current() ?? null,
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
        const fromError = getFlow(capture.error);
        if (fromError.length > 0) {
            source = 'error';
            evidence = true;
            chain = fromError;
        }
    }
    if (source === 'none' && capture.frameEdge !== undefined) {
        // the frame holds the LIVE edge (dive's enter payload), alive as
        // long as the frame — getFlow cannot come back empty here
        const fromFrame = getFlow(capture.frameEdge);
        if (fromFrame.length > 0) {
            source = 'async-frame';
            evidence = true;
            chain = fromFrame;
        }
    }
    if (source === 'none' && capture.current !== null) {
        const fromCurrent = getFlow(capture.current);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItYW5hbHlzaXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZXJyb3ItYW5hbHlzaXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUNHO0FBQ0gsT0FBTyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUVuRCxPQUFPLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBUW5ELHVFQUF1RTtBQUN2RSxNQUFNLFdBQVcsR0FBRyxpQkFBaUIsQ0FBQztBQUN0QyxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDO0FBQ3JELE1BQU0sV0FBVyxHQUFHLHdCQUF3QixDQUFDO0FBQzdDLE1BQU0sYUFBYSxHQUFHLDBCQUEwQixDQUFDO0FBZWpELE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDO0FBQzdCLE1BQU0scUJBQXFCLEdBQUcsRUFBRSxDQUFDO0FBOENqQyxNQUFNLFVBQVUsWUFBWSxDQUFFLEtBQWMsRUFBRSxJQUF3QjtJQUNyRSxNQUFNLEtBQUssR0FBRyxJQUFJLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxDQUFDO0lBQzlDLE1BQU0sT0FBTyxHQUFpQjtRQUM3QixLQUFLO1FBQ0wsY0FBYyxFQUFHLEtBQUssRUFBRSxTQUFTLElBQUksRUFBRTtRQUN2QyxPQUFPLEVBQVUsT0FBTyxFQUFFLElBQUksSUFBSTtLQUNsQyxDQUFDO0lBQ0YsSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQy9CLE9BQU8sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztJQUNoQyxDQUFDO0lBQ0QsT0FBTyxPQUFPLENBQUM7QUFDaEIsQ0FBQztBQUVELHlFQUF5RTtBQUN6RSw0RUFBNEU7QUFDNUUsd0VBQXdFO0FBQ3hFLE1BQU0sZUFBZSxHQUFHLENB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UUFBUSxDQUFDLE1BQU07UUFDakMsQ0FBQyxhQUFhLENBQUMsRUFBRyxRQUFRLENBQUMsUUFBUTtLQUNuQyxDQUFDO0lBQ0YsSUFBSSxRQUFRLENBQUMsT0FBTyxLQUFLLElBQUksRUFBRSxDQUFDO1FBQy9CLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztBQUN4QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBFcnJvciBhbmFseXNpcyDigJQgZXJyb3Ig4oaSIGl0cyBkaXZlIGVkZ2Ug4oaSIGl0cyBpbnN0YW5jZXMuXG4gKlxuICogT24gdW5jYXVnaHRFeGNlcHRpb24gL1xuICogdW5oYW5kbGVkUmVqZWN0aW9uIHRoZXJlIGlzIGFuIGVycm9yIHRvIGFuYWx5c2U7IHRoaXMgbW9kdWxlIGZpbmRzXG4gKiBXSElDSCBkaXZlIGVkZ2UgaXQgY2FtZSBmcm9tLCB3YWxrcyB0aGF0IGVkZ2UncyBjaGFpbiwgYW5kIGNvbGxlY3RzIHRoZVxuICogaW5zdGFuY2VzIHdpcmVkIHRvIGl0IOKAlCByZXR1cm5pbmcgREFUQSwgbmV2ZXIgcHJpbnRpbmcgYW55dGhpbmcgKHRoZVxuICogY2FsbGVyIGRlY2lkZXMgd2hhdCB0byBsb2c7IG5vdGhpbmcgaGVyZSB3cml0ZXMgdG8gc3Rkb3V0IG9yIGNvbnNvbGUpLlxuICpcbiAqIFR3byBwaGFzZXMsIGJlY2F1c2UgYWZ0ZXIgdW5jYXVnaHRFeGNlcHRpb24gdGhlIHBvZCBtYXkgYmUga2lsbGVkIGFuZFxuICogZGVmZXJyZWQgd29yayBtYXkgbmV2ZXIgcnVuOlxuICpcbiAqIC0gY2FwdHVyZUVycm9yKGVycm9yLCBkZXBzPykg4oCUIFBIQVNFIDEsIHN5bmNocm9ub3VzIGFuZCBjaGVhcDoga2VlcHNcbiAqICAgUkVGRVJFTkNFUyBvbmx5ICh0aGUgZXJyb3IsIHRoZSBhc3luYy1mbG93IGZyYW1lJ3MgZWRnZSBhbmRcbiAqICAgcGlubmVkIGluc3RhbmNlcyB3aGVuIGEgcHJvdmlkZXIgaXMgZ2l2ZW4sIGRpdmUuY3VycmVudCgpKS4gTm8gc3RhY2tcbiAqICAgcmVhZGluZywgbm8gZ3JhcGhzLlxuICogLSBhbmFseXNlRXJyb3IoY2FwdHVyZSwgYnVkZ2V0Pykg4oCUIFBIQVNFIDIsIG9ubHkgd2hlbiB0aGUgY2FsbGVyIGFza3M6XG4gKiAgIHBpY2tzIHRoZSBlZGdlIGNoYWluIGZyb20gdGhlIEZJUlNUIHNvdXJjZSB0aGF0IGhhcyBvbmUg4oCUXG4gKiAgICAgKGEpIGdldEZsb3coZXJyb3IpICAgICAgICAgICAgICDigJQgdGhlIGVycm9yIHdhcyBwaW5uZWQgYnkgZGl2ZSdzIG93blxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3cmFwcGVyOiBFVklERU5DRTtcbiAqICAgICAoYikgZ2V0RmxvdyhmcmFtZS5lZGdlKSAgICAgICAgIOKAlCB0aGUgQUxTIGZyYW1lIGF0IGNyYXNoIHRpbWU6IGFsc29cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRVZJREVOQ0Ugb24gTm9kZS4gRGl2ZSBoYW5kcyB0aGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTElWRSBlZGdlIGluIHRoZSBlbnRlciBwYXlsb2FkLCBhbmRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGZyYW1lIGtlZXBzIGl0IChwbHVzLCB0aHJvdWdoXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRpdmUncyBwYXJlbnQgbGlua3MsIGl0cyBhbmNlc3RvcnMpXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsaXZlIGFzIGxvbmcgYXMgdGhlIHNjb3BlJ3MgYXN5bmNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd29yayBsaXZlcyDigJQgdGhlIHNhbWUgd2F5IGEgcGVuZGluZ1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lciBrZWVwcyBpdHMgYnJhbmNoLiBUaGUgZWRnZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYW5ub3QgYmUgXCJhbHJlYWR5IGNvbGxlY3RlZFwiIHdoaWxlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBmcmFtZSBleGlzdHM7XG4gKiAgICAgKGMpIGdldEZsb3coY2FwdHVyZS5jdXJyZW50KSAgICDigJQgZGl2ZSdzIHJlc3QgcmVzaWR1ZTogYSBsYWJlbGxlZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBHVUVTUywgbmV2ZXIgZXZpZGVuY2U7XG4gKiAgICAgKGQpIG5vbmUgICAgICAgICAgICAgICAgICAgICAgICDigJQgc291cmNlICdub25lJy5cbiAqICAgT25lIGNvcmUgdXRpbHMubGluZWFnZSBncmFwaCBpcyBidWlsdCBvdmVyIHRoZSBESVNUSU5DVCBMSVZFIGluc3RhbmNlc1xuICogICBvZiB0aGUgY2hhaW4gKGNvbGxlY3RlZCBpbnN0YW5jZXMgYXJlIHNraXBwZWQgYW5kIGNvdW50ZWQpLiBCdWRnZXQge1xuICogICBtYXhFZGdlcywgbWF4SW5zdGFuY2VzIH0gYm91bmRzIHRoZSB3b3JrOyBldmVyeSB0cnVuY2F0aW9uIGlzIHJlcG9ydGVkXG4gKiAgIGluIHRoZSByZXN1bHQsIG5ldmVyIHNpbGVudC5cbiAqXG4gKiAtIHJlY29yZEVycm9yQW5hbHlzaXMoYW5hbHlzaXMsIHNwYW4pIHB1dHMgdGhlIHJlc3VsdCBvbiBhIHNwYW4gVEhFXG4gKiAgIENBTExFUiBQQVNTRVM6IG9uZSAnbW5lbW9uaWNhLmVycm9yJyBldmVudCB3aXRoIHRoZSBsaW5lYWdlIGdyYXBoIEpTT05cbiAqICAgaW4gJ21uZW1vbmljYS5saW5lYWdlLmdyYXBoJyBwbHVzIHRoZSBzb3VyY2UgYW5kIHRoZSBldmlkZW5jZSBmbGFnLlxuICovXG5pbXBvcnQgeyBnZXRGbG93LCBjdXJyZW50IH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB0eXBlIHsgRmxvd0VkZ2UgfSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuaW1wb3J0IHsgdXRpbHMsIGdldFByb3BzIH0gZnJvbSAnbW5lbW9uaWNhL21vZHVsZSc7XG5pbXBvcnQgdHlwZSB7IFNwYW4gfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHR5cGUgeyBBc3luY0Zsb3dQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXJzL2FzeW5jLWZsb3cucHJvdmlkZXIuanMnO1xuXG4vKiogY29yZSBkb2VzIG5vdCByZS1leHBvcnQgdGhlIExpbmVhZ2VHcmFwaCBuYW1lIGZyb20gaXRzIGVudHJ5IGQudHMg4oCUXG4gKiAgdGhlIGdyYXBoIHR5cGUgaXMgZXhhY3RseSB3aGF0IHV0aWxzLmxpbmVhZ2UgcmV0dXJucyAqL1xudHlwZSBMaW5lYWdlR3JhcGggPSBSZXR1cm5UeXBlPHR5cGVvZiB1dGlscy5saW5lYWdlPjtcblxuLyoqIHRoZSBzcGFuIGV2ZW50IGFuZCBhdHRyaWJ1dGUgbmFtZXMg4oCUIHRoZSBjcm9zcy1sYW5ndWFnZSBjb250cmFjdCAqL1xuY29uc3QgRVZFTlRfRVJST1IgPSAnbW5lbW9uaWNhLmVycm9yJztcbmNvbnN0IEFUVFJfTElORUFHRV9HUkFQSCA9ICdtbmVtb25pY2EubGluZWFnZS5ncmFwaCc7XG5jb25zdCBBVFRSX1NPVVJDRSA9ICdtbmVtb25pY2EuZXJyb3Iuc291cmNlJztcbmNvbnN0IEFUVFJfRVZJREVOQ0UgPSAnbW5lbW9uaWNhLmVycm9yLmV2aWRlbmNlJztcblxuZXhwb3J0IHR5cGUgRXJyb3JTb3VyY2UgPSAnZXJyb3InIHwgJ2FzeW5jLWZyYW1lJyB8ICdsYXN0LWNvbnRleHQnIHwgJ25vbmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQW5hbHlzaXNEZXBzIHtcblx0YXN5bmNGbG93PzogQXN5bmNGbG93UHJvdmlkZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5hbHlzaXNCdWRnZXQge1xuXHQvKiogY2hhaW4gbGVuZ3RoIGNhcDsgdGhlIGZhaWx1cmUtcHJveGltYWwgVEFJTCBpcyBrZXB0ICovXG5cdG1heEVkZ2VzPyAgICAgOiBudW1iZXI7XG5cdC8qKiBkaXN0aW5jdCBsaXZlIGluc3RhbmNlcyBmZWQgaW50byB0aGUgbGluZWFnZSBncmFwaCAqL1xuXHRtYXhJbnN0YW5jZXM/IDogbnVtYmVyO1xufVxuXG5jb25zdCBERUZBVUxUX01BWF9FREdFUyA9IDMyO1xuY29uc3QgREVGQVVMVF9NQVhfSU5TVEFOQ0VTID0gMTY7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5hbHlzZWRFZGdlIHtcblx0a2luZCAgICAgOiBzdHJpbmc7XG5cdG5hbWUgICAgIDogc3RyaW5nO1xuXHRzdGF0dXMgICA6IHN0cmluZztcblx0Y2FsbHNpdGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JBbmFseXNpcyB7XG5cdHNvdXJjZSAgICAgICAgICAgICAgIDogRXJyb3JTb3VyY2U7XG5cdGV2aWRlbmNlICAgICAgICAgICAgIDogYm9vbGVhbjtcblx0bWVzc2FnZSAgICAgICAgICAgICAgOiBzdHJpbmc7XG5cdGVkZ2VzICAgICAgICAgICAgICAgIDogQW5hbHlzZWRFZGdlW107XG5cdC8qKiBjaGFpbiBlZGdlcyBjdXQgYnkgbWF4RWRnZXMgKHRoZSBmYWlsdXJlLXByb3hpbWFsIHRhaWwgd2FzIGtlcHQpICovXG5cdGVkZ2VzVHJ1bmNhdGVkICAgICAgIDogbnVtYmVyO1xuXHQvKiogdGhlIGVycm9yIGl0c2VsZiBJUyBhIGZhaWxlZCBtbmVtb25pY2EgY29uc3RydWN0aW9uICovXG5cdGZhaWxlZENvbnN0cnVjdGlvbj8gIDoge1xuXHRcdHR5cGVOYW1lICAgICA6IHN0cmluZztcblx0XHRhdHRlbXB0ZWRBcmdzOiB1bmtub3duO1xuXHR9O1xuXHQvKiogT05FIGNvcmUgdXRpbHMubGluZWFnZSBncmFwaCBvdmVyIHRoZSBjaGFpbidzIGRpc3RpbmN0IGxpdmVcblx0ICogIGluc3RhbmNlczsgbnVsbCB3aGVuIHRoZSBjaGFpbiBjYXJyaWVkIG5vbmUgKi9cblx0bGluZWFnZSAgICAgICAgICAgICAgOiBMaW5lYWdlR3JhcGggfCBudWxsO1xuXHRpbnN0YW5jZXMgICAgICAgICAgICA6IG51bWJlcjtcblx0LyoqIGNoYWluIGVkZ2VzIHdob3NlIGluc3RhbmNlIHdhcyBhbHJlYWR5IGNvbGxlY3RlZCDigJQgc2tpcHBlZCwgY291bnRlZCAqL1xuXHRpbnN0YW5jZXNTa2lwcGVkICAgICA6IG51bWJlcjtcblx0LyoqIGxpdmUgaW5zdGFuY2VzIGN1dCBieSBtYXhJbnN0YW5jZXMgKG5ldmVyIGVudGVyZWQgdGhlIGdyYXBoKSAqL1xuXHRpbnN0YW5jZXNUcnVuY2F0ZWQgICA6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBQSEFTRSAxIOKAlCBzeW5jaHJvbm91cyBjYXB0dXJlIG9mIFJFRkVSRU5DRVMgb25seS4gU2FmZSBpbnNpZGUgYW5cbiAqIHVuY2F1Z2h0RXhjZXB0aW9uIGhhbmRsZXI6IG5vIHN0YWNrIHJlYWRpbmcsIG5vIGdyYXBoIGJ1aWxkaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQ2FwdHVyZSB7XG5cdGVycm9yICAgICAgICAgIDogdW5rbm93bjtcblx0LyoqIHRoZSBBTFMgZnJhbWUncyBlZGdlICh0aGUgTElWRSBlZGdlIGRpdmUgaGFuZHMgaW4gdGhlIGVudGVyIHBheWxvYWQpLFxuXHQgKiAgd2hlbiBhIHByb3ZpZGVyIHdhcyBnaXZlbiBhdCBjYXB0dXJlIOKAlCB0aGUgZnJhbWUga2VlcHMgaXQgYWxpdmUgKi9cblx0ZnJhbWVFZGdlPyAgICAgOiBGbG93RWRnZTtcblx0LyoqIHRoZSBmcmFtZSdzIHBpbm5lZCBjb250ZXh0IGluc3RhbmNlcyAoc3Ryb25nIHJlZnMsIHJlcXVlc3QtbGlmZXRpbWUpICovXG5cdGZyYW1lSW5zdGFuY2VzIDogb2JqZWN0W107XG5cdC8qKiBkaXZlLmN1cnJlbnQoKSBhdCBjYXB0dXJlIHRpbWUg4oCUIHRoZSByZXN0IHJlc2lkdWUgKi9cblx0Y3VycmVudCAgICAgICAgOiBvYmplY3QgfCBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZUVycm9yIChlcnJvcjogdW5rbm93biwgZGVwcz86IEVycm9yQW5hbHlzaXNEZXBzKTogRXJyb3JDYXB0dXJlIHtcblx0Y29uc3QgZnJhbWUgPSBkZXBzPy5hc3luY0Zsb3c/LmN1cnJlbnRGcmFtZSgpO1xuXHRjb25zdCBjYXB0dXJlOiBFcnJvckNhcHR1cmUgPSB7XG5cdFx0ZXJyb3IsXG5cdFx0ZnJhbWVJbnN0YW5jZXMgOiBmcmFtZT8uaW5zdGFuY2VzID8/IFtdLFxuXHRcdGN1cnJlbnQgICAgICAgIDogY3VycmVudCgpID8/IG51bGwsXG5cdH07XG5cdGlmIChmcmFtZT8uZWRnZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0Y2FwdHVyZS5mcmFtZUVkZ2UgPSBmcmFtZS5lZGdlO1xuXHR9XG5cdHJldHVybiBjYXB0dXJlO1xufVxuXG4vLyB0aGUgYXR0ZW1wdGVkIGNvbnN0cnVjdG9yIGFyZ3Mgb2YgYSBGQUlMRUQgbW5lbW9uaWNhIGNvbnN0cnVjdGlvbiByaWRlXG4vLyB0aGUgZXJyb3JlZCBzaGVsbCBpdHNlbGY6IGdldFByb3BzIGV4cG9zZXMgeyBhcmdzLCBvcmlnaW5hbEVycm9yLCDigKYgfSBvZmZcbi8vIHRoZSBwcm9wcyBXZWFrTWFwLiBEZWdyYWRlcyB0byB1bmRlZmluZWQg4oCUIG5ldmVyIHRocm93cyBvbiB0aGlzIHBhdGguXG5jb25zdCBlcnJvcmVkQXJnc1NhZmUgPSAoZXJyb3I6IEVycm9yKTogdW5rbm93biA9PiB7XG5cdHRyeSB7XG5cdFx0Y29uc3QgcHJvcHMgPSBnZXRQcm9wcyhlcnJvcikgYXMgeyBhcmdzPzogdW5rbm93biB9IHwgdW5kZWZpbmVkO1xuXHRcdGNvbnN0IHJlc3VsdCA9IHByb3BzPy5hcmdzO1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH0gY2F0Y2gge1xuXHRcdGNvbnN0IHJlc3VsdCA9IHVuZGVmaW5lZDtcblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG59O1xuXG5jb25zdCBpc0ZhaWxlZENvbnN0cnVjdGlvbiA9IChlcnJvcjogdW5rbm93bik6IGVycm9yIGlzIEVycm9yID0+IHtcblx0Y29uc3QgZmFpbGVkQ2hlY2sgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGdldFByb3BzKGVycm9yKSAhPT0gdW5kZWZpbmVkO1xuXHRyZXR1cm4gZmFpbGVkQ2hlY2s7XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gYW5hbHlzZUVycm9yIChcblx0Y2FwdHVyZSAgOiBFcnJvckNhcHR1cmUsXG5cdGJ1ZGdldCAgIDogQW5hbHlzaXNCdWRnZXQgPSB7fSxcbik6IEVycm9yQW5hbHlzaXMge1xuXHRjb25zdCBtYXhFZGdlcyA9IGJ1ZGdldC5tYXhFZGdlcyA/PyBERUZBVUxUX01BWF9FREdFUztcblx0Y29uc3QgbWF4SW5zdGFuY2VzID0gYnVkZ2V0Lm1heEluc3RhbmNlcyA/PyBERUZBVUxUX01BWF9JTlNUQU5DRVM7XG5cdGNvbnN0IG1lc3NhZ2UgPSBjYXB0dXJlLmVycm9yIGluc3RhbmNlb2YgRXJyb3Jcblx0XHQ/IGNhcHR1cmUuZXJyb3IubWVzc2FnZVxuXHRcdDogU3RyaW5nKGNhcHR1cmUuZXJyb3IpO1xuXG5cdC8vIC0tLSBwaWNrIHRoZSBjaGFpbiBmcm9tIHRoZSBGSVJTVCBzb3VyY2UgdGhhdCBoYXMgb25lXG5cdGxldCBzb3VyY2U6IEVycm9yU291cmNlID0gJ25vbmUnO1xuXHRsZXQgZXZpZGVuY2UgPSBmYWxzZTtcblx0bGV0IGNoYWluOiBGbG93RWRnZVtdID0gW107XG5cblx0aWYgKGNhcHR1cmUuZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuXHRcdGNvbnN0IGZyb21FcnJvciA9IGdldEZsb3coY2FwdHVyZS5lcnJvcik7XG5cdFx0aWYgKGZyb21FcnJvci5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnZXJyb3InO1xuXHRcdFx0ZXZpZGVuY2UgPSB0cnVlO1xuXHRcdFx0Y2hhaW4gPSBmcm9tRXJyb3I7XG5cdFx0fVxuXHR9XG5cdGlmIChzb3VyY2UgPT09ICdub25lJyAmJiBjYXB0dXJlLmZyYW1lRWRnZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0Ly8gdGhlIGZyYW1lIGhvbGRzIHRoZSBMSVZFIGVkZ2UgKGRpdmUncyBlbnRlciBwYXlsb2FkKSwgYWxpdmUgYXNcblx0XHQvLyBsb25nIGFzIHRoZSBmcmFtZSDigJQgZ2V0RmxvdyBjYW5ub3QgY29tZSBiYWNrIGVtcHR5IGhlcmVcblx0XHRjb25zdCBmcm9tRnJhbWUgPSBnZXRGbG93KGNhcHR1cmUuZnJhbWVFZGdlKTtcblx0XHRpZiAoZnJvbUZyYW1lLmxlbmd0aCA+IDApIHtcblx0XHRcdHNvdXJjZSA9ICdhc3luYy1mcmFtZSc7XG5cdFx0XHRldmlkZW5jZSA9IHRydWU7XG5cdFx0XHRjaGFpbiA9IGZyb21GcmFtZTtcblx0XHR9XG5cdH1cblx0aWYgKHNvdXJjZSA9PT0gJ25vbmUnICYmIGNhcHR1cmUuY3VycmVudCAhPT0gbnVsbCkge1xuXHRcdGNvbnN0IGZyb21DdXJyZW50ID0gZ2V0RmxvdyhjYXB0dXJlLmN1cnJlbnQpO1xuXHRcdGlmIChmcm9tQ3VycmVudC5sZW5ndGggPiAwKSB7XG5cdFx0XHRzb3VyY2UgPSAnbGFzdC1jb250ZXh0Jztcblx0XHRcdGV2aWRlbmNlID0gZmFsc2U7XG5cdFx0XHRjaGFpbiA9IGZyb21DdXJyZW50O1xuXHRcdH1cblx0fVxuXG5cdC8vIC0tLSBidWRnZXQgdGhlIGNoYWluOiB0aGUgZmFpbHVyZS1wcm94aW1hbCBUQUlMIGlzIGtlcHRcblx0Y29uc3QgZWRnZXNUcnVuY2F0ZWQgPSBNYXRoLm1heCgwLCBjaGFpbi5sZW5ndGggLSBtYXhFZGdlcyk7XG5cdGNvbnN0IGtlcHRFZGdlcyA9IGNoYWluLnNsaWNlKC1tYXhFZGdlcyk7XG5cdGNvbnN0IGVkZ2VzOiBBbmFseXNlZEVkZ2VbXSA9IGtlcHRFZGdlcy5tYXAoKGVkZ2UpID0+IHtcblx0XHRjb25zdCBhbmFseXNlZDogQW5hbHlzZWRFZGdlID0ge1xuXHRcdFx0a2luZCAgIDogZWRnZS5raW5kLFxuXHRcdFx0bmFtZSAgIDogZWRnZS5uYW1lLFxuXHRcdFx0c3RhdHVzIDogZWRnZS5zdGF0dXMsXG5cdFx0fTtcblx0XHRpZiAoZWRnZS5jYWxsc2l0ZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRhbmFseXNlZC5jYWxsc2l0ZSA9IGVkZ2UuY2FsbHNpdGU7XG5cdFx0fVxuXHRcdHJldHVybiBhbmFseXNlZDtcblx0fSk7XG5cblx0Ly8gLS0tIHRoZSBlcnJvciBpdHNlbGYgSVMgYSBmYWlsZWQgbW5lbW9uaWNhIGNvbnN0cnVjdGlvblxuXHRsZXQgZmFpbGVkQ29uc3RydWN0aW9uOiBFcnJvckFuYWx5c2lzWydmYWlsZWRDb25zdHJ1Y3Rpb24nXTtcblx0aWYgKGlzRmFpbGVkQ29uc3RydWN0aW9uKGNhcHR1cmUuZXJyb3IpKSB7XG5cdFx0Y29uc3QgcHJvcHMgPSBnZXRQcm9wcyhjYXB0dXJlLmVycm9yKSBhcyB7XG5cdFx0XHRfX3R5cGVfXz86IHsgVHlwZU5hbWU/OiBzdHJpbmcgfTtcblx0XHR9IHwgdW5kZWZpbmVkO1xuXHRcdGNvbnN0IHR5cGVOYW1lID0gcHJvcHM/Ll9fdHlwZV9fPy5UeXBlTmFtZSA/PyBjYXB0dXJlLmVycm9yLmNvbnN0cnVjdG9yLm5hbWU7XG5cdFx0ZmFpbGVkQ29uc3RydWN0aW9uID0ge1xuXHRcdFx0dHlwZU5hbWUsXG5cdFx0XHRhdHRlbXB0ZWRBcmdzIDogZXJyb3JlZEFyZ3NTYWZlKGNhcHR1cmUuZXJyb3IpLFxuXHRcdH07XG5cdH1cblxuXHQvLyAtLS0gT05FIGxpbmVhZ2UgZ3JhcGggb3ZlciB0aGUgRElTVElOQ1QgTElWRSBpbnN0YW5jZXMgb2YgdGhlIGNoYWluXG5cdGNvbnN0IHNlZW4gPSBuZXcgU2V0PG9iamVjdD4oKTtcblx0Y29uc3QgbGl2ZUluc3RhbmNlczogb2JqZWN0W10gPSBbXTtcblx0bGV0IGluc3RhbmNlc1NraXBwZWQgPSAwO1xuXHRmb3IgKGNvbnN0IGVkZ2Ugb2Yga2VwdEVkZ2VzKSB7XG5cdFx0Y29uc3QgaW5zdGFuY2UgPSBlZGdlLmluc3RhbmNlO1xuXHRcdGlmIChpbnN0YW5jZSA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0XHQvLyBjb3VudCBvbmx5IGluc3RhbmNlcyB0aGF0IFdFUkUgdGhlcmUgYW5kIGdvdCBjb2xsZWN0ZWQ7XG5cdFx0XHQvLyBlZGdlcyByZWNvcmRlZCB3aXRob3V0IGFuIGluc3RhbmNlIGFyZSBub3Qgc2tpcHBlZCBkYXRhXG5cdFx0XHRpZiAoZWRnZS5pbnN0YW5jZUNvbGxlY3RlZCA9PT0gdHJ1ZSkge1xuXHRcdFx0XHRpbnN0YW5jZXNTa2lwcGVkICs9IDE7XG5cdFx0XHR9XG5cdFx0XHRjb250aW51ZTtcblx0XHR9XG5cdFx0aWYgKHNlZW4uaGFzKGluc3RhbmNlKSkge1xuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXHRcdHNlZW4uYWRkKGluc3RhbmNlKTtcblx0XHRsaXZlSW5zdGFuY2VzLnB1c2goaW5zdGFuY2UpO1xuXHR9XG5cdGNvbnN0IGluc3RhbmNlc1RydW5jYXRlZCA9IE1hdGgubWF4KDAsIGxpdmVJbnN0YW5jZXMubGVuZ3RoIC0gbWF4SW5zdGFuY2VzKTtcblx0Y29uc3Qga2VwdEluc3RhbmNlcyA9IGxpdmVJbnN0YW5jZXMuc2xpY2UoMCwgbWF4SW5zdGFuY2VzKTtcblx0Y29uc3QgbGluZWFnZTogTGluZWFnZUdyYXBoIHwgbnVsbCA9IGtlcHRJbnN0YW5jZXMubGVuZ3RoID4gMFxuXHRcdD8gdXRpbHMubGluZWFnZShrZXB0SW5zdGFuY2VzKVxuXHRcdDogbnVsbDtcblxuXHRjb25zdCBhbmFseXNpczogRXJyb3JBbmFseXNpcyA9IHtcblx0XHRzb3VyY2UsXG5cdFx0ZXZpZGVuY2UsXG5cdFx0bWVzc2FnZSxcblx0XHRlZGdlcyxcblx0XHRlZGdlc1RydW5jYXRlZCxcblx0XHRsaW5lYWdlLFxuXHRcdGluc3RhbmNlcyAgICAgICAgICAgIDoga2VwdEluc3RhbmNlcy5sZW5ndGgsXG5cdFx0aW5zdGFuY2VzU2tpcHBlZCxcblx0XHRpbnN0YW5jZXNUcnVuY2F0ZWQsXG5cdH07XG5cdGlmIChmYWlsZWRDb25zdHJ1Y3Rpb24gIT09IHVuZGVmaW5lZCkge1xuXHRcdGFuYWx5c2lzLmZhaWxlZENvbnN0cnVjdGlvbiA9IGZhaWxlZENvbnN0cnVjdGlvbjtcblx0fVxuXHRyZXR1cm4gYW5hbHlzaXM7XG59XG5cbi8qKlxuICogUHV0IHRoZSBhbmFseXNpcyBvbiBhIHNwYW4gVEhFIENBTExFUiBQQVNTRVMg4oCUIG9uZSAnbW5lbW9uaWNhLmVycm9yJ1xuICogZXZlbnQ6IHRoZSBsaW5lYWdlIGdyYXBoIEpTT04gaW4gJ21uZW1vbmljYS5saW5lYWdlLmdyYXBoJywgcGx1cyB0aGVcbiAqIHNvdXJjZSBhbmQgdGhlIGV2aWRlbmNlIGZsYWcuIE5vIHNwYW4gaXMgY3JlYXRlZCBoZXJlOyBubyBzdGRvdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRFcnJvckFuYWx5c2lzIChhbmFseXNpczogRXJyb3JBbmFseXNpcywgc3BhbjogU3Bhbik6IHZvaWQge1xuXHRjb25zdCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiA9IHtcblx0XHRbQVRUUl9TT1VSQ0VdICAgOiBhbmFseXNpcy5zb3VyY2UsXG5cdFx0W0FUVFJfRVZJREVOQ0VdIDogYW5hbHlzaXMuZXZpZGVuY2UsXG5cdH07XG5cdGlmIChhbmFseXNpcy5saW5lYWdlICE9PSBudWxsKSB7XG5cdFx0YXR0cmlidXRlc1tBVFRSX0xJTkVBR0VfR1JBUEhdID0gSlNPTi5zdHJpbmdpZnkoYW5hbHlzaXMubGluZWFnZSk7XG5cdH1cblx0c3Bhbi5hZGRFdmVudChFVkVOVF9FUlJPUiwgYXR0cmlidXRlcyk7XG59XG4iXX0=