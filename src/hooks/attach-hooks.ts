/**
 * attachHooks — the mnemonica lifecycle wiring for @mnemonica/dive.
 *
 * This lived inside dive itself until dive became engine-only: dive imports
 * nothing but node:crypto and exposes primitives (wrap, recordCreation, …);
 * the knowledge of mnemonica's hook contract — hook names, hooksOpts fields,
 * and what a ROOT construction is — belongs here at adapter level.
 *
 * preCreation  → enter the parent (existentInstance) context BEFORE the
 *                constructor runs, and wrap any function arguments so
 *                callbacks handed to the constructor carry that context.
 * postCreation → record the instance's 'create' edge via recordCreation,
 *                then wrap the instance's methods.
 * creationError→ record a failed 'create' edge (status: 'error') under the
 *                surviving parent and pin the error to it: the failure is
 *                recoverable off the error object itself.
 *
 * All of it runs against ONE dive: the default dive unless the caller
 * passes their own (`new Dive()` from @mnemonica/dive) via options.dive —
 * the collection then traces into that dive alone.
 */
import {
	resolveDive,
	type DiveApi,
	type DiveOption,
} from '../dive-api.js';
import type { AnyFn } from '@mnemonica/dive';
import type { TypesCollection } from 'mnemonica/module';

export type AttachHooksOptions = DiveOption;

// `typeof === 'function'` narrows to the banned bare Function type; this
// guard re-grounds the value to dive's AnyFn instead (never[] accepts
// every parameter list — the caller's signature is the caller's business)
const isAnyFn = (value: unknown): value is AnyFn => {
	const result = typeof value === 'function';
	return result;
};

export function attachHooks (collection: TypesCollection, options?: AttachHooksOptions): void {
	const dive: DiveApi = resolveDive(options);
	collection.registerHook('preCreation', (hookData) => {
		const parent = hookData.existentInstance;
		if (parent) {
			dive.enterContext(parent);
		}
		const { args } = hookData;
		if (Array.isArray(args)) {
			for (let i = 0; i < args.length; i++) {
				const arg = args[ i ];
				if (isAnyFn(arg) && !dive.isWrappedFunction(arg)) {
					args[ i ] = dive.wrapConstructorArg(arg, parent);
				}
			}
		}
	});

	collection.registerHook('postCreation', (hookData) => {
		const instance = hookData.inheritedInstance;
		if (!instance) {
			return;
		}
		if (Array.isArray(hookData.args)) {
			for (const arg of hookData.args) {
				dive.upgradeConstructorArg(arg, instance);
			}
		}
		dive.recordCreation(hookData.TypeName || 'anonymous', instance, hookData.existentInstance);
		dive.wrapInstanceMethods(instance);
	});

	collection.registerHook('creationError', (hookData) => {
		dive.recordCreationError(
			hookData.TypeName || 'anonymous',
			hookData.inheritedInstance,
			hookData.existentInstance
		);
	});
}
