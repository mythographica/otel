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
import { type DiveOption } from '../dive-api.js';
import type { TypesCollection } from 'mnemonica/module';
export type AttachHooksOptions = DiveOption;
export declare function attachHooks(collection: TypesCollection, options?: AttachHooksOptions): void;
//# sourceMappingURL=attach-hooks.d.ts.map