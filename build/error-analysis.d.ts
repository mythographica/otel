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
import { type DiveApi } from './dive-api.js';
import type { FlowEdge } from '@mnemonica/dive';
import { utils } from 'mnemonica/module';
import type { Span } from '@opentelemetry/api';
import type { AsyncFlowProvider } from './providers/async-flow.provider.js';
/** core does not re-export the LineageGraph name from its entry d.ts —
 *  the graph type is exactly what utils.lineage returns */
type LineageGraph = ReturnType<typeof utils.lineage>;
export type ErrorSource = 'error' | 'async-frame' | 'last-context' | 'none';
export interface ErrorAnalysisDeps {
    asyncFlow?: AsyncFlowProvider;
    /** the dive to read the trace from — the default dive unless the caller
     *  traces through their own */
    dive?: DiveApi;
}
export interface AnalysisBudget {
    /** chain length cap; the failure-proximal TAIL is kept */
    maxEdges?: number;
    /** distinct live instances fed into the lineage graph */
    maxInstances?: number;
}
export interface AnalysedEdge {
    kind: string;
    name: string;
    status: string;
    callsite?: string;
}
export interface ErrorAnalysis {
    source: ErrorSource;
    evidence: boolean;
    message: string;
    edges: AnalysedEdge[];
    /** chain edges cut by maxEdges (the failure-proximal tail was kept) */
    edgesTruncated: number;
    /** the error itself IS a failed mnemonica construction */
    failedConstruction?: {
        typeName: string;
        attemptedArgs: unknown;
    };
    /** ONE core utils.lineage graph over the chain's distinct live
     *  instances; null when the chain carried none */
    lineage: LineageGraph | null;
    instances: number;
    /** chain edges whose instance was already collected — skipped, counted */
    instancesSkipped: number;
    /** live instances cut by maxInstances (never entered the graph) */
    instancesTruncated: number;
}
/**
 * PHASE 1 — synchronous capture of REFERENCES only. Safe inside an
 * uncaughtException handler: no stack reading, no graph building.
 */
export interface ErrorCapture {
    error: unknown;
    /** the ALS frame's edge (the LIVE edge dive hands in the enter payload),
     *  when a provider was given at capture — the frame keeps it alive */
    frameEdge?: FlowEdge;
    /** the frame's pinned context instances (strong refs, request-lifetime) */
    frameInstances: object[];
    /** dive.current() at capture time — the rest residue */
    current: object | null;
    /** the dive the trace is read from at analyse time — resolved at
     *  capture (the default dive when none was given) so the capture alone
     *  is enough for analyseError */
    dive?: DiveApi;
}
export declare function captureError(error: unknown, deps?: ErrorAnalysisDeps): ErrorCapture;
export declare function analyseError(capture: ErrorCapture, budget?: AnalysisBudget): ErrorAnalysis;
/**
 * Put the analysis on a span THE CALLER PASSES — one 'mnemonica.error'
 * event: the lineage graph JSON in 'mnemonica.lineage.graph', plus the
 * source and the evidence flag. No span is created here; no stdout.
 */
export declare function recordErrorAnalysis(analysis: ErrorAnalysis, span: Span): void;
export {};
//# sourceMappingURL=error-analysis.d.ts.map