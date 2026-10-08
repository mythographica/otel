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