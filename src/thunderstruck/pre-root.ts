/**
 * Thunderstruck pre-root correlation store (adapter side).
 *
 * The correlation key is OBJECT IDENTITY: the very body / query / params
 * object the interceptor saw at the boundary is the same reference pipes and
 * construct handlers receive later. A WeakMap<object, payloads> therefore
 * correlates without AsyncLocalStorage and without races — concurrent
 * requests can never read each other's payloads because each holds only its
 * own objects.
 *
 * The payloads live INSIDE the WeakMap record: there is no other store and
 * no release step. When the request objects are garbage-collected, the
 * payloads go with them — retention is exactly the request's lifetime.
 * Dive stays free of framework-specifics and of storage entirely: it is
 * the tracing engine, not a warehouse.
 *
 * The optional `request` link (RawPreRootPayload.request) puts the raw
 * request object inside its own record and stamps it as a key too, so
 * getPreRoot(req) resolves from anywhere the request is reachable. The
 * WeakMap's ephemeron semantics keep this value→key cycle collectable:
 * retention stays exactly the request's lifetime.
 */

export interface RawPreRootPayload {
	method  : string;
	url     : string;
	params? : unknown;
	query?  : unknown;
	body?   : unknown;
	headers?: unknown;
	/**
	 * Optional link to the raw request object (storeRequest flag). When
	 * present it is stamped as a correlation key too, so getPreRoot(req)
	 * resolves — e.g. from an exception filter holding only the request.
	 */
	request?: unknown;
}

export interface PreRootRecord {
	raw       : unknown;
	validated?: unknown;
}

export interface PreRootData {
	raw?      : unknown;
	validated?: unknown;
}

function isObjectKey (value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

const preRootRecords = new WeakMap<object, PreRootRecord>();

/**
 * Stash the raw boundary payload and stamp every request-part object
 * (params / query / body / headers / request) so later stages correlate
 * by the object they already hold. Primitive bodies are not correlatable —
 * they are still inside the raw payload, just not resolvable via
 * getPreRoot.
 */
export function feedPreRoot (raw: RawPreRootPayload): void {
	const record: PreRootRecord = { raw };
	for (const part of [raw.params, raw.query, raw.body, raw.headers, raw.request]) {
		if (isObjectKey(part)) {
			preRootRecords.set(part, record);
		}
	}
}

/**
 * Attach the validated DTO to the record of the boundary object it came
 * from. Called by MnemonicaValidationPipe after class-validator passes.
 * No-op when the object was never stamped (the interceptor is not active).
 */
export function feedValidatedPreRoot (forValue: unknown, validated: unknown): void {
	if (!isObjectKey(forValue)) {
		return;
	}
	const record = preRootRecords.get(forValue);
	if (!record) {
		return;
	}
	record.validated = validated;
}

/**
 * Resolve the pre-root payloads for a boundary object — the same body /
 * query / params reference the interceptor stamped. Payloads live as long
 * as the request objects do (WeakMap), so this resolves during construction
 * AND afterwards — e.g. from an exception filter reporting which data
 * caused the failure.
 */
export function getPreRoot (value: unknown): PreRootData | undefined {
	if (!isObjectKey(value)) {
		return undefined;
	}
	const record = preRootRecords.get(value);
	if (!record) {
		return undefined;
	}
	const result: PreRootData = {
		raw       : record.raw,
		validated : record.validated,
	};
	return result;
}
