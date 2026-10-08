/**
 * @mnemonica/otel — the framework-free Node.js core of the mnemonica
 * observability stack.
 *
 * Everything here works in ANY Node.js runtime (Express, Fastify, raw
 * http, queue consumers, CLI); framework wiring lives in dedicated
 * adapter packages built on these primitives.
 *
 * Provides:
 *   - attachHooks() — mnemonica lifecycle → dive edge wiring
 *   - MnemonicaOtelProvider — OTel spans for constructions
 *   - DiveOtelProvider — OTel spans for every dive-wrapped call
 *   - AsyncFlowProvider — ALS backbone attributing unwrapped async hops
 *   - runInEntryScope() — one root span per unit of work (request, message,
 *     command) + the triple scope entry (provider ALS, OTEL global context,
 *     async-flow root frame); framework wiring is README recipes on top
 *   - feedPreRoot()/feedValidatedPreRoot()/getPreRoot() — thunderstruck
 *     pre-root forensics store (identity-correlated, request-lifetime)
 *   - captureError()/analyseError()/recordErrorAnalysis() — the error
 *     analysis: error → its dive edge → its instances (data returned, never
 *     printed); the lineage graph rides a span event the caller passes
 *   - isMnemonicaInstance() — realm-safe type guard
 *   - formatFlow()/errorContext() — read-side helpers over dive's trace
 */

export { attachHooks } from './hooks/attach-hooks.js';
export { MnemonicaOtelProvider } from './providers/mnemonica-otel.provider.js';
export { DiveOtelProvider } from './providers/dive-otel.provider.js';
export { AsyncFlowProvider, type FlowFrame, type CrashContext } from './providers/async-flow.provider.js';
export { runInEntryScope, type EntryDefinition, type EntryScopeDeps } from './entry-scope.js';
export {
	feedPreRoot,
	feedValidatedPreRoot,
	getPreRoot,
	type RawPreRootPayload,
	type PreRootRecord,
	type PreRootData,
} from './thunderstruck/pre-root.js';
export {
	captureError,
	analyseError,
	recordErrorAnalysis,
	type ErrorSource,
	type ErrorAnalysis,
	type ErrorCapture,
	type ErrorAnalysisDeps,
	type AnalysisBudget,
	type AnalysedEdge,
} from './error-analysis.js';
export { isMnemonicaInstance } from './utils/is-mnemonica-instance.js';
export { formatFlow, errorContext, type FormattedFlowEdge } from './utils/dive-flow.js';
