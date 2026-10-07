/**
 * Entry scope — the neutral boundary for any unit of work: an HTTP
 * request, a queue message, a CLI command, a test. Framework wiring is a
 * few lines on top (recipes in the README); this core stays
 * framework-agnostic — no req/res shapes anywhere.
 *
 * runInEntryScope opens ONE root span named entry.name, makes it current
 * for BOTH the mnemonica provider's store (otel.runWithSpan — what
 * MnemonicaOtelProvider's construction spans look up) AND the OTel global
 * context (what DiveOtelProvider adopts at boundaries), and opens the
 * async-flow root frame when an AsyncFlowProvider is given (every async
 * hop of the entry inherits it via ALS propagation).
 *
 * Lifetime: by default the span ends when fn returns, or — when fn
 * returns a native Promise — when that promise settles; a throw or a
 * rejection sets the span's error status, records the exception, then
 * rethrows. Non-native thenables are plain values (never touched): return
 * a native promise (an async function) if the span should cover the async
 * work. With endOnReturn: false the caller owns the ending (e.g. an HTTP
 * recipe ends the span on response finish). fn receives the span and its
 * result passes through unchanged.
 */
import type { Attributes, Span, Tracer } from '@opentelemetry/api';
import { context as otelContext, trace, SpanStatusCode } from '@opentelemetry/api';
import type { MnemonicaOtelProvider } from './providers/mnemonica-otel.provider.js';
import type { AsyncFlowProvider } from './providers/async-flow.provider.js';

/** The providers the entry scope drives — the same trio the HTTP scope took. */
export interface EntryScopeDeps {
	tracer     : Tracer;
	otel       : MnemonicaOtelProvider;
	asyncFlow? : AsyncFlowProvider;
}

/** What to open: the span name, optional starting attributes, lifetime. */
export interface EntryDefinition {
	name        : string;
	attributes? : Attributes;
	/**
	 * false → the caller ends the span (span.end() when the unit of work
	 * truly completes — a response 'finish', a settlement the entry does
	 * not see). Default true: end when fn returns or its promise settles.
	 */
	endOnReturn? : boolean;
}

const failSpan = (span: Span, error: unknown): void => {
	span.setStatus({
		code    : SpanStatusCode.ERROR,
		message : error instanceof Error ? error.message : String(error),
	});
	if (error instanceof Error) {
		span.recordException(error);
	} else {
		span.setAttribute('exception.type', 'non-Error-throw');
	}
};

export function runInEntryScope<T> (
	entry : EntryDefinition,
	deps  : EntryScopeDeps,
	fn    : (span: Span) => T,
): T {
	const span = deps.tracer.startSpan(entry.name);
	if (entry.attributes) {
		span.setAttributes(entry.attributes);
	}

	const activeCtx = trace.setSpan(otelContext.active(), span);
	const endOnReturn = entry.endOnReturn !== false;

	const run = (): T => {
		try {
			const result = deps.otel.runWithSpan(span, () => {
				return otelContext.with(activeCtx, () => {
					return fn(span);
				});
			});
			if (!endOnReturn) {
				return result;
			}
			// only a NATIVE Promise is treated as async work: a non-native
			// thenable (e.g. a lazy query builder that starts its work on
			// every then() call) must never be touched here — calling its
			// then() would run the work a second time for the caller. Return
			// a native promise (an async function) if the span should cover
			// the async work; any other value ends the span on return.
			if (result instanceof Promise) {
				// side chain ONLY: the handlers touch the span and never
				// rethrow, so this creates no extra unhandled rejection —
				// fn's own promise is returned unchanged
				void result.then(
					() => {
						span.end();
					},
					(error: unknown) => {
						failSpan(span, error);
						span.end();
					},
				);
				return result;
			}
			span.end();
			return result;
		} catch (error) {
			failSpan(span, error);
			if (endOnReturn) {
				span.end();
			}
			throw error;
		}
	};

	if (deps.asyncFlow) {
		return deps.asyncFlow.runInScope(run);
	}
	return run();
}
