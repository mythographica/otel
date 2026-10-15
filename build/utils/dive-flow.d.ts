/**
 * Read-side helpers over @mnemonica/dive's trace — the two idioms error
 * boundaries kept re-deriving by hand (four formatter copies and two
 * fallback copies in finecut before these existed).
 *
 * Both read from the default dive unless the caller passes their own via
 * options.dive — the same optional-dive contract as the rest of the
 * package (see dive-api.ts).
 */
import { type DiveOption } from '../dive-api.js';
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
export declare function formatFlow(target?: unknown, options?: DiveOption): FormattedFlowEdge[];
/**
 * The "who failed" fallback: the instance pinned to the error at its
 * deepest wrapped boundary, or the current ambient context when the error
 * never crossed one.
 */
export declare function errorContext(error: Error, options?: DiveOption): object | undefined;
//# sourceMappingURL=dive-flow.d.ts.map