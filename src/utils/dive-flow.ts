/**
 * Read-side helpers over @mnemonica/dive's trace — the two idioms error
 * boundaries kept re-deriving by hand (four formatter copies and two
 * fallback copies in finecut before these existed).
 */
import { getFlow, getErrorInstance, current } from '@mnemonica/dive';
import type { FlowEdge } from '@mnemonica/dive';

/**
 * JSON-safe shape of a trace edge: the FlowEdge without the live instance
 * reference (mnemonica instances don't survive serialization), duration
 * normalized to null while unsettled.
 */
export interface FormattedFlowEdge {
	name     : string;
	kind     : FlowEdge['kind'];
	status   : FlowEdge['status'];
	duration : number | null;
}

/**
 * Canonical edge → plain-JSON shaping for reports, filters and logs.
 * Same target semantics as getFlow: Error | instance | current cursor.
 */
export function formatFlow (target?: unknown): FormattedFlowEdge[] {
	const result = getFlow(target).map((edge) => {
		const formatted: FormattedFlowEdge = {
			name     : edge.name,
			kind     : edge.kind,
			status   : edge.status,
			duration : edge.duration ?? null,
		};
		return formatted;
	});
	return result;
}

/**
 * The "who failed" fallback: the instance pinned to the error at its
 * deepest wrapped boundary, or the current ambient context when the error
 * never crossed one.
 */
export function errorContext (error: Error): object | undefined {
	const pinned = getErrorInstance(error);
	const result = pinned ?? current();
	return result;
}
