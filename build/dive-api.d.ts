/**
 * The optional-dive contract: every public API here that reads or subscribes
 * to dive accepts an optional dive and defaults to the DEFAULT dive (the
 * free functions of @mnemonica/dive). An app tracing through its own
 * `new Dive()` passes it in — without the option, otel sees only the
 * default dive and that app gets no spans.
 *
 * DiveApi is exactly the slice of the dive surface otel uses, structurally
 * typed: a `Dive` instance satisfies it as-is, and so does the default
 * object below — the free functions ARE the default dive's bound methods,
 * so the literal needs no cast.
 */
import { type Dive } from '@mnemonica/dive';
export type DiveApi = Pick<Dive, 'enterContext' | 'wrapConstructorArg' | 'upgradeConstructorArg' | 'wrapInstanceMethods' | 'recordCreation' | 'recordCreationError' | 'isWrappedFunction' | 'getFlow' | 'getErrorInstance' | 'current' | 'registerHook'>;
/**
 * The default dive, pre-bound. Shared so that "no dive given" costs one
 * property read, never an allocation, and so every default path subscribes
 * to the same dive the free functions drive.
 */
export declare const defaultDiveApi: DiveApi;
/** Options carrier for the APIs that take no other options. */
export interface DiveOption {
    dive?: DiveApi;
}
/** Resolve the caller's dive or the default one. */
export declare function resolveDive(option?: DiveOption): DiveApi;
//# sourceMappingURL=dive-api.d.ts.map