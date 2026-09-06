/**
 * OpenTelemetry provider for mnemonica lifecycle hooks.
 *
 * Creates spans for preCreation / postCreation / creationError,
 * parents them along the prototype chain, and propagates
 * context via AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Tracer, Span } from '@opentelemetry/api';
import { trace, context as otelContext } from '@opentelemetry/api';
import type { hooksOpts, TypesCollection } from 'mnemonica/module';

const SymbolParentSpan = Symbol.for('mnemonica.span.parent');
const asyncStorage = new AsyncLocalStorage<Span>();

export class MnemonicaOtelProvider {
	private tracer: Tracer;
	// spans of constructions in flight, keyed on the per-call args array
	// (the only value core guarantees identical between pre and post hooks)
	private pendingSpans = new WeakMap<object, Span>();

	constructor (tracer?: Tracer) {
		this.tracer = tracer ?? trace.getTracer('@mnemonica/otel');
	}

	getCurrentSpan (): Span | undefined {
		return asyncStorage.getStore();
	}

	runWithSpan<T> (span: Span, fn: () => T): T {
		return asyncStorage.run(span, fn);
	}

	attachHooks (collection: TypesCollection): void {
		collection.registerHook('preCreation', (hookData: hooksOpts) => {
			const parentSpan = this.findParentSpan(hookData);
			const ctx = parentSpan
				? trace.setSpan(otelContext.active(), parentSpan)
				: undefined;
			const span = parentSpan
				? this.tracer.startSpan(
					`mnemonica.${hookData.TypeName}`,
					{},
					ctx
				)
				: this.tracer.startSpan(`mnemonica.${hookData.TypeName}`);

			span.setAttribute('mnemonica.type_name', hookData.TypeName);
			span.setAttribute('mnemonica.hook', 'preCreation');

			// Store the pending span keyed on the construction's args array:
			// core passes the identical args reference to preCreation and to
			// postCreation/creationError, and it is unique per construction call.
			// Keying on the parent instance would collide when async constructions
			// of siblings interleave (preA, preB, postB, postA — the second
			// preCreation would overwrite the first).
			this.pendingSpans.set(hookData.args, span);
		});

		collection.registerHook('postCreation', (hookData: hooksOpts) => {
			const newInstance = hookData.inheritedInstance;
			if (newInstance == null || typeof newInstance !== 'object') {
				return;
			}

			// Retrieve and remove the pending span for this construction
			let span = this.pendingSpans.get(hookData.args);
			this.pendingSpans.delete(hookData.args);

			if (!span) {
				// Fallback: create span here if preCreation didn't (shouldn't happen)
				span = this.tracer.startSpan(`mnemonica.${hookData.TypeName}`);
				span.setAttribute('mnemonica.type_name', hookData.TypeName);
			}

			span.setAttribute('mnemonica.hook', 'postCreation');
			span.end();

			// Store on new instance so its children can find the parent span
			Object.defineProperty(newInstance, SymbolParentSpan, {
				value       : span,
				configurable: true,
				enumerable  : false,
				writable    : true,
			});
		});

		collection.registerHook('creationError', (hookData: hooksOpts) => {
			const newInstance = hookData.inheritedInstance;
			if (newInstance == null || typeof newInstance !== 'object') {
				return;
			}

			// Retrieve and remove the pending span for this construction
			let span = this.pendingSpans.get(hookData.args);
			this.pendingSpans.delete(hookData.args);

			if (!span) {
				span = this.tracer.startSpan(`mnemonica.${hookData.TypeName}`);
				span.setAttribute('mnemonica.type_name', hookData.TypeName);
			}

			span.setAttribute('mnemonica.hook', 'creationError');
			span.setAttribute('error.type', 'Error');
			span.recordException(newInstance as Error);
			span.end();

			// Store on error instance for chain tracing
			Object.defineProperty(newInstance, SymbolParentSpan, {
				value       : span,
				configurable: true,
				enumerable  : false,
				writable    : true,
			});
		});
	}

	private findParentSpan (hookData: hooksOpts): Span | undefined {
		const stored = asyncStorage.getStore();
		if (stored) {
			return stored;
		}

		const parent = hookData.existentInstance;
		if (parent == null || typeof parent !== 'object') {
			return undefined;
		}

		let current: object | null = parent;
		while (current) {
			const span = (current as Record<symbol, unknown>)[SymbolParentSpan] as Span | undefined;
			if (span) {
				return span;
			}
			current = Object.getPrototypeOf(current);
		}

		return undefined;
	}
}
