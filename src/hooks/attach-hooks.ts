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
 */
import {
	enterContext,
	wrapConstructorArg,
	upgradeConstructorArg,
	wrapInstanceMethods,
	recordCreation,
	recordCreationError,
	isWrappedFunction,
} from '@mnemonica/dive';
import type { TypesCollection } from 'mnemonica/module';

export function attachHooks (collection: TypesCollection): void {
	collection.registerHook('preCreation', (hookData) => {
		const parent = hookData.existentInstance;
		if (parent) {
			enterContext(parent);
		}
		const args = hookData.args;
		if (Array.isArray(args)) {
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				if (typeof arg === 'function' && !isWrappedFunction(arg)) {
					args[i] = wrapConstructorArg(arg as (...a: unknown[]) => unknown, parent);
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
				upgradeConstructorArg(arg, instance);
			}
		}
		recordCreation(hookData.TypeName || 'anonymous', instance, hookData.existentInstance);
		wrapInstanceMethods(instance);
	});

	collection.registerHook('creationError', (hookData) => {
		recordCreationError(
			hookData.TypeName || 'anonymous',
			hookData.inheritedInstance,
			hookData.existentInstance
		);
	});
}
