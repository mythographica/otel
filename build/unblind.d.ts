export interface UnblindReport {
    kind: string;
    message: string;
    branch: string[];
    erroredType: string | null;
    erroredInstance: unknown;
    attemptedArgs: unknown;
}
/**
 * extract() that cannot throw inside an error path — non-mnemonica
 * values degrade to their key list.
 */
export declare function extractSafe(instance: object): unknown;
/**
 * The attempted constructor args of a FAILED mnemonica construction ride
 * the errored instance itself: the caught object IS the errored shell
 * (probed 2026-09-03: caught === creationError's inheritedInstance,
 * instanceof Error via the spliced prototype chain), and core's own
 * getProps exposes { args, originalError, … } off the props WeakMap.
 * Plain errors yield undefined; anything unexpected degrades, never
 * throws inside a filter.
 */
export declare function erroredArgsSafe(error: Error): unknown;
/**
 * JSON.stringify that cannot throw inside an error path — circular or
 * hostile values degrade to a marker instead of crashing the boundary
 * (a throwing boundary is exactly the cascade this fights).
 */
export declare function stringifySafe(value: unknown): string;
/**
 * Build the unblinded report for a caught failure: the dive branch, the
 * errored construction edge, the attempted constructor args, the actual
 * message. Non-Error throws are reported truthfully as such, never
 * dressed up as Errors.
 */
export declare function buildUnblindReport(error: unknown): UnblindReport;
/**
 * The unconditional half: an ERROR span with the recorded exception + the
 * dive branch — inside the request's async context, so the ALS context
 * manager parents it under the request span on its own — and the stdout
 * marker line. A non-Error throw is recorded as an attribute:
 * recordException on a circular object could break exporter
 * serialization.
 */
export declare function recordUnblindTelemetry(report: UnblindReport, error: unknown): void;
//# sourceMappingURL=unblind.d.ts.map