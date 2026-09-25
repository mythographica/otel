/**
 * The Unblinder core — framework-free error-boundary
 * reporting: build the report from dive's trace + core's getProps, then
 * record the telemetry. The framework wrapper owns the body discipline
 * (status code, the headers-sent check, expected-client-error passthrough);
 * this core owns the report and the UNCONDITIONAL telemetry.
 *
 * CONTRACT: report.kind ('caught-unblinded'), the span name
 * ('mnemonica.caught-exception') and the [unblind] stdout marker are
 * pinned by downstream consumers (runbooks grep the marker; framework
 * adapters pin the report shape). Keep them stable.
 */
import { getFlow } from '@mnemonica/dive';
import { utils, getProps } from 'mnemonica';
import { trace, SpanStatusCode } from '@opentelemetry/api';

export interface UnblindReport {
	kind            : string;
	message         : string;
	branch          : string[];
	erroredType     : string | null;
	erroredInstance : unknown;
	attemptedArgs   : unknown;
}

/**
 * extract() that cannot throw inside an error path — non-mnemonica
 * values degrade to their key list.
 */
export function extractSafe (instance: object): unknown {
	try {
		const result = utils.extract(instance);
		return result;
	} catch {
		const result = Object.keys(instance);
		return result;
	}
}

/**
 * The attempted constructor args of a FAILED mnemonica construction ride
 * the errored instance itself: the caught object IS the errored shell
 * (probed: caught === creationError's inheritedInstance,
 * instanceof Error via the spliced prototype chain), and core's own
 * getProps exposes { args, originalError, … } off the props WeakMap.
 * Plain errors yield undefined; anything unexpected degrades, never
 * throws inside a filter.
 */
export function erroredArgsSafe (error: Error): unknown {
	try {
		const props = getProps(error) as { args?: unknown } | undefined;
		const result = props?.args;
		return result;
	} catch {
		const result = undefined;
		return result;
	}
}

/**
 * JSON.stringify that cannot throw inside an error path — circular or
 * hostile values degrade to a marker instead of crashing the boundary
 * (a throwing boundary is exactly the cascade this fights).
 */
export function stringifySafe (value: unknown): string {
	try {
		const result = JSON.stringify(value);
		return result;
	} catch {
		const result = '"[unserializable report payload]"';
		return result;
	}
}

/**
 * Build the unblinded report for a caught failure: the dive branch, the
 * errored construction edge, the attempted constructor args, the actual
 * message. Non-Error throws are reported truthfully as such, never
 * dressed up as Errors.
 */
export function buildUnblindReport (error: unknown): UnblindReport {
	const isError = error instanceof Error;
	const message = isError ? error.message : `non-Error thrown (${typeof error})`;
	const flow = isError ? getFlow(error as Error) : [];
	// The errored create edge attributes the construction's PARENT
	// instance (probed: edge.instance === existentInstance).
	// The attempted constructor ARGS ride the caught error itself — it
	// IS the errored shell, and getProps exposes its args (see
	// erroredArgsSafe above).
	const erroredEdge = [...flow].reverse().find((edge) => edge.kind === 'create' && edge.status === 'error');
	const erroredInstance = erroredEdge?.instance;
	const attemptedArgs = isError ? erroredArgsSafe(error as Error) : undefined;
	const report: UnblindReport = {
		kind            : 'caught-unblinded',
		message,
		branch          : flow.map((edge) => `${edge.kind}:${edge.name}`),
		erroredType     : erroredEdge?.name ?? null,
		erroredInstance : erroredInstance ? extractSafe(erroredInstance) : null,
		attemptedArgs   : attemptedArgs ?? null,
	};
	return report;
}

/**
 * The unconditional half: an ERROR span with the recorded exception + the
 * dive branch — inside the request's async context, so the ALS context
 * manager parents it under the request span on its own — and the stdout
 * marker line. A non-Error throw is recorded as an attribute:
 * recordException on a circular object could break exporter
 * serialization.
 */
export function recordUnblindTelemetry (report: UnblindReport, error: unknown): void {
	const span = trace.getTracer('@mnemonica/otel').startSpan('mnemonica.caught-exception');
	span.setAttribute('dive.branch', report.branch.join(' → '));
	if (report.erroredType) {
		span.setAttribute('mnemonica.errored_type', report.erroredType);
	}
	span.setStatus({ code: SpanStatusCode.ERROR, message: report.message });
	if (error instanceof Error) {
		span.recordException(error);
	} else {
		span.setAttribute('exception.type', 'non-Error-throw');
	}
	span.end();

	// The [unblind] prefix is a downstream contract — runbooks grep for
	// exactly this marker.
	// eslint-disable-next-line no-console
	console.log(`[unblind] ${stringifySafe(report)}`);
}
