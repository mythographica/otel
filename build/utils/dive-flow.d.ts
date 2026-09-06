import type { FlowEdge } from '@mnemonica/dive';
/**
 * JSON-safe shape of a trace edge: the FlowEdge without the live instance
 * reference (mnemonica instances don't survive serialization), duration
 * normalized to null while unsettled.
 */
export interface FormattedFlowEdge {
    name: string;
    kind: FlowEdge['kind'];
    status: FlowEdge['status'];
    duration: number | null;
}
/**
 * Canonical edge → plain-JSON shaping for reports, filters and logs.
 * Same target semantics as getFlow: Error | instance | current cursor.
 */
export declare function formatFlow(target?: unknown): FormattedFlowEdge[];
/**
 * The "who failed" fallback: the instance pinned to the error at its
 * deepest wrapped boundary, or the current ambient context when the error
 * never crossed one.
 */
export declare function errorContext(error: Error): object | undefined;
//# sourceMappingURL=dive-flow.d.ts.map