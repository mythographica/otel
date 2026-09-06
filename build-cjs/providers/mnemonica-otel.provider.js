"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MnemonicaOtelProvider = void 0;
/**
 * OpenTelemetry provider for mnemonica lifecycle hooks.
 *
 * Creates spans for preCreation / postCreation / creationError,
 * parents them along the prototype chain, and propagates
 * context via AsyncLocalStorage.
 */
const async_hooks_1 = require("async_hooks");
const api_1 = require("@opentelemetry/api");
const SymbolParentSpan = Symbol.for('mnemonica.span.parent');
const asyncStorage = new async_hooks_1.AsyncLocalStorage();
class MnemonicaOtelProvider {
    tracer;
    // spans of constructions in flight, keyed on the per-call args array
    // (the only value core guarantees identical between pre and post hooks)
    pendingSpans = new WeakMap();
    constructor(tracer) {
        this.tracer = tracer ?? api_1.trace.getTracer('@mnemonica/otel');
    }
    getCurrentSpan() {
        return asyncStorage.getStore();
    }
    runWithSpan(span, fn) {
        return asyncStorage.run(span, fn);
    }
    attachHooks(collection) {
        collection.registerHook('preCreation', (hookData) => {
            const parentSpan = this.findParentSpan(hookData);
            const ctx = parentSpan
                ? api_1.trace.setSpan(api_1.context.active(), parentSpan)
                : undefined;
            const span = parentSpan
                ? this.tracer.startSpan(`mnemonica.${hookData.TypeName}`, {}, ctx)
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
        collection.registerHook('postCreation', (hookData) => {
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
                value: span,
                configurable: true,
                enumerable: false,
                writable: true,
            });
        });
        collection.registerHook('creationError', (hookData) => {
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
            span.recordException(newInstance);
            span.end();
            // Store on error instance for chain tracing
            Object.defineProperty(newInstance, SymbolParentSpan, {
                value: span,
                configurable: true,
                enumerable: false,
                writable: true,
            });
        });
    }
    findParentSpan(hookData) {
        const stored = asyncStorage.getStore();
        if (stored) {
            return stored;
        }
        const parent = hookData.existentInstance;
        if (parent == null || typeof parent !== 'object') {
            return undefined;
        }
        let current = parent;
        while (current) {
            const span = current[SymbolParentSpan];
            if (span) {
                return span;
            }
            current = Object.getPrototypeOf(current);
        }
        return undefined;
    }
}
exports.MnemonicaOtelProvider = MnemonicaOtelProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcHJvdmlkZXJzL21uZW1vbmljYS1vdGVsLnByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7Ozs7R0FNRztBQUNILDZDQUFnRDtBQUVoRCw0Q0FBbUU7QUFHbkUsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUM7QUFDN0QsTUFBTSxZQUFZLEdBQUcsSUFBSSwrQkFBaUIsRUFBUSxDQUFDO0FBRW5ELE1BQWEscUJBQXFCO0lBQ3pCLE1BQU0sQ0FBUztJQUN2QixxRUFBcUU7SUFDckUsd0VBQXdFO0lBQ2hFLFlBQVksR0FBRyxJQUFJLE9BQU8sRUFBZ0IsQ0FBQztJQUVuRCxZQUFhLE1BQWU7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksV0FBSyxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRCxjQUFjO1FBQ2IsT0FBTyxZQUFZLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVELFdBQVcsQ0FBSyxJQUFVLEVBQUUsRUFBVztRQUN0QyxPQUFPLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFRCxXQUFXLENBQUUsVUFBMkI7UUFDdkMsVUFBVSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxRQUFtQixFQUFFLEVBQUU7WUFDOUQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNqRCxNQUFNLEdBQUcsR0FBRyxVQUFVO2dCQUNyQixDQUFDLENBQUMsV0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFXLENBQUMsTUFBTSxFQUFFLEVBQUUsVUFBVSxDQUFDO2dCQUNqRCxDQUFDLENBQUMsU0FBUyxD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O0FBNUhELHNEQTRIQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT3BlblRlbGVtZXRyeSBwcm92aWRlciBmb3IgbW5lbW9uaWNhIGxpZmVjeWNsZSBob29rcy5cbiAqXG4gKiBDcmVhdGVzIHNwYW5zIGZvciBwcmVDcmVhdGlvbiAvIHBvc3RDcmVhdGlvbiAvIGNyZWF0aW9uRXJyb3IsXG4gKiBwYXJlbnRzIHRoZW0gYWxvbmcgdGhlIHByb3RvdHlwZSBjaGFpbiwgYW5kIHByb3BhZ2F0ZXNcbiAqIGNvbnRleHQgdmlhIEFzeW5jTG9jYWxTdG9yYWdlLlxuICovXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ2FzeW5jX2hvb2tzJztcbmltcG9ydCB0eXBlIHsgVHJhY2VyLCBTcGFuIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB7IHRyYWNlLCBjb250ZXh0IGFzIG90ZWxDb250ZXh0IH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB0eXBlIHsgaG9va3NPcHRzLCBUeXBlc0NvbGxlY3Rpb24gfSBmcm9tICdtbmVtb25pY2EvbW9kdWxlJztcblxuY29uc3QgU3ltYm9sUGFyZW50U3BhbiA9IFN5bWJvbC5mb3IoJ21uZW1vbmljYS5zcGFuLnBhcmVudCcpO1xuY29uc3QgYXN5bmNTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPFNwYW4+KCk7XG5cbmV4cG9ydCBjbGFzcyBNbmVtb25pY2FPdGVsUHJvdmlkZXIge1xuXHRwcml2YXRlIHRyYWNlcjogVHJhY2VyO1xuXHQvLyBzcGFucyBvZiBjb25zdHJ1Y3Rpb25zIGluIGZsaWdodCwga2V5ZWQgb24gdGhlIHBlci1jYWxsIGFyZ3MgYXJyYXlcblx0Ly8gKHRoZSBvbmx5IHZhbHVlIGNvcmUgZ3VhcmFudGVlcyBpZGVudGljYWwgYmV0d2VlbiBwcmUgYW5kIHBvc3QgaG9va3MpXG5cdHByaXZhdGUgcGVuZGluZ1NwYW5zID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBTcGFuPigpO1xuXG5cdGNvbnN0cnVjdG9yICh0cmFjZXI/OiBUcmFjZXIpIHtcblx0XHR0aGlzLnRyYWNlciA9IHRyYWNlciA/PyB0cmFjZS5nZXRUcmFjZXIoJ0BtbmVtb25pY2Evb3RlbCcpO1xuXHR9XG5cblx0Z2V0Q3VycmVudFNwYW4gKCk6IFNwYW4gfCB1bmRlZmluZWQge1xuXHRcdHJldHVybiBhc3luY1N0b3JhZ2UuZ2V0U3RvcmUoKTtcblx0fVxuXG5cdHJ1bldpdGhTcGFuPFQ+IChzcGFuOiBTcGFuLCBmbjogKCkgPT4gVCk6IFQge1xuXHRcdHJldHVybiBhc3luY1N0b3JhZ2UucnVuKHNwYW4sIGZuKTtcblx0fVxuXG5cdGF0dGFjaEhvb2tzIChjb2xsZWN0aW9uOiBUeXBlc0NvbGxlY3Rpb24pOiB2b2lkIHtcblx0XHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygncHJlQ3JlYXRpb24nLCAoaG9va0RhdGE6IGhvb2tzT3B0cykgPT4ge1xuXHRcdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oaG9va0RhdGEpO1xuXHRcdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdFx0Y29uc3Qgc3BhbiA9IHBhcmVudFNwYW5cblx0XHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4oXG5cdFx0XHRcdFx0YG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWAsXG5cdFx0XHRcdFx0e30sXG5cdFx0XHRcdFx0Y3R4XG5cdFx0XHRcdClcblx0XHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4oYG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWApO1xuXG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLnR5cGVfbmFtZScsIGhvb2tEYXRhLlR5cGVOYW1lKTtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EuaG9vaycsICdwcmVDcmVhdGlvbicpO1xuXG5cdFx0XHQvLyBTdG9yZSB0aGUgcGVuZGluZyBzcGFuIGtleWVkIG9uIHRoZSBjb25zdHJ1Y3Rpb24ncyBhcmdzIGFycmF5OlxuXHRcdFx0Ly8gY29yZSBwYXNzZXMgdGhlIGlkZW50aWNhbCBhcmdzIHJlZmVyZW5jZSB0byBwcmVDcmVhdGlvbiBhbmQgdG9cblx0XHRcdC8vIHBvc3RDcmVhdGlvbi9jcmVhdGlvbkVycm9yLCBhbmQgaXQgaXMgdW5pcXVlIHBlciBjb25zdHJ1Y3Rpb24gY2FsbC5cblx0XHRcdC8vIEtleWluZyBvbiB0aGUgcGFyZW50IGluc3RhbmNlIHdvdWxkIGNvbGxpZGUgd2hlbiBhc3luYyBjb25zdHJ1Y3Rpb25zXG5cdFx0XHQvLyBvZiBzaWJsaW5ncyBpbnRlcmxlYXZlIChwcmVBLCBwcmVCLCBwb3N0QiwgcG9zdEEg4oCUIHRoZSBzZWNvbmRcblx0XHRcdC8vIHByZUNyZWF0aW9uIHdvdWxkIG92ZXJ3cml0ZSB0aGUgZmlyc3QpLlxuXHRcdFx0dGhpcy5wZW5kaW5nU3BhbnMuc2V0KGhvb2tEYXRhLmFyZ3MsIHNwYW4pO1xuXHRcdH0pO1xuXG5cdFx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3Bvc3RDcmVhdGlvbicsIChob29rRGF0YTogaG9va3NPcHRzKSA9PiB7XG5cdFx0XHRjb25zdCBuZXdJbnN0YW5jZSA9IGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlO1xuXHRcdFx0aWYgKG5ld0luc3RhbmNlID09IG51bGwgfHwgdHlwZW9mIG5ld0luc3RhbmNlICE9PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdC8vIFJldHJpZXZlIGFuZCByZW1vdmUgdGhlIHBlbmRpbmcgc3BhbiBmb3IgdGhpcyBjb25zdHJ1Y3Rpb25cblx0XHRcdGxldCBzcGFuID0gdGhpcy5wZW5kaW5nU3BhbnMuZ2V0KGhvb2tEYXRhLmFyZ3MpO1xuXHRcdFx0dGhpcy5wZW5kaW5nU3BhbnMuZGVsZXRlKGhvb2tEYXRhLmFyZ3MpO1xuXG5cdFx0XHRpZiAoIXNwYW4pIHtcblx0XHRcdFx0Ly8gRmFsbGJhY2s6IGNyZWF0ZSBzcGFuIGhlcmUgaWYgcHJlQ3JlYXRpb24gZGlkbid0IChzaG91bGRuJ3QgaGFwcGVuKVxuXHRcdFx0XHRzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKGBtbmVtb25pY2EuJHtob29rRGF0YS5UeXBlTmFtZX1gKTtcblx0XHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ21uZW1vbmljYS50eXBlX25hbWUnLCBob29rRGF0YS5UeXBlTmFtZSk7XG5cdFx0XHR9XG5cblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EuaG9vaycsICdwb3N0Q3JlYXRpb24nKTtcblx0XHRcdHNwYW4uZW5kKCk7XG5cblx0XHRcdC8vIFN0b3JlIG9uIG5ldyBpbnN0YW5jZSBzbyBpdHMgY2hpbGRyZW4gY2FuIGZpbmQgdGhlIHBhcmVudCBzcGFuXG5cdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkobmV3SW5zdGFuY2UsIFN5bWJvbFBhcmVudFNwYW4sIHtcblx0XHRcdFx0dmFsdWUgICAgICAgOiBzcGFuLFxuXHRcdFx0XHRjb25maWd1cmFibGU6IHRydWUsXG5cdFx0XHRcdGVudW1lcmFibGUgIDogZmFsc2UsXG5cdFx0XHRcdHdyaXRhYmxlICAgIDogdHJ1ZSxcblx0XHRcdH0pO1xuXHRcdH0pO1xuXG5cdFx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ2NyZWF0aW9uRXJyb3InLCAoaG9va0RhdGE6IGhvb2tzT3B0cykgPT4ge1xuXHRcdFx0Y29uc3QgbmV3SW5zdGFuY2UgPSBob29rRGF0YS5pbmhlcml0ZWRJbnN0YW5jZTtcblx0XHRcdGlmIChuZXdJbnN0YW5jZSA9PSBudWxsIHx8IHR5cGVvZiBuZXdJbnN0YW5jZSAhPT0gJ29iamVjdCcpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBSZXRyaWV2ZSBhbmQgcmVtb3ZlIHRoZSBwZW5kaW5nIHNwYW4gZm9yIHRoaXMgY29uc3RydWN0aW9uXG5cdFx0XHRsZXQgc3BhbiA9IHRoaXMucGVuZGluZ1NwYW5zLmdldChob29rRGF0YS5hcmdzKTtcblx0XHRcdHRoaXMucGVuZGluZ1NwYW5zLmRlbGV0ZShob29rRGF0YS5hcmdzKTtcblxuXHRcdFx0aWYgKCFzcGFuKSB7XG5cdFx0XHRcdHNwYW4gPSB0aGlzLnRyYWNlci5zdGFydFNwYW4oYG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWApO1xuXHRcdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLnR5cGVfbmFtZScsIGhvb2tEYXRhLlR5cGVOYW1lKTtcblx0XHRcdH1cblxuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ21uZW1vbmljYS5ob29rJywgJ2NyZWF0aW9uRXJyb3InKTtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdlcnJvci50eXBlJywgJ0Vycm9yJyk7XG5cdFx0XHRzcGFuLnJlY29yZEV4Y2VwdGlvbihuZXdJbnN0YW5jZSBhcyBFcnJvcik7XG5cdFx0XHRzcGFuLmVuZCgpO1xuXG5cdFx0XHQvLyBTdG9yZSBvbiBlcnJvciBpbnN0YW5jZSBmb3IgY2hhaW4gdHJhY2luZ1xuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5ld0luc3RhbmNlLCBTeW1ib2xQYXJlbnRTcGFuLCB7XG5cdFx0XHRcdHZhbHVlICAgICAgIDogc3Bhbixcblx0XHRcdFx0Y29uZmlndXJhYmxlOiB0cnVlLFxuXHRcdFx0XHRlbnVtZXJhYmxlICA6IGZhbHNlLFxuXHRcdFx0XHR3cml0YWJsZSAgICA6IHRydWUsXG5cdFx0XHR9KTtcblx0XHR9KTtcblx0fVxuXG5cdHByaXZhdGUgZmluZFBhcmVudFNwYW4gKGhvb2tEYXRhOiBob29rc09wdHMpOiBTcGFuIHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBzdG9yZWQgPSBhc3luY1N0b3JhZ2UuZ2V0U3RvcmUoKTtcblx0XHRpZiAoc3RvcmVkKSB7XG5cdFx0XHRyZXR1cm4gc3RvcmVkO1xuXHRcdH1cblxuXHRcdGNvbnN0IHBhcmVudCA9IGhvb2tEYXRhLmV4aXN0ZW50SW5zdGFuY2U7XG5cdFx0aWYgKHBhcmVudCA9PSBudWxsIHx8IHR5cGVvZiBwYXJlbnQgIT09ICdvYmplY3QnKSB7XG5cdFx0XHRyZXR1cm4gdW5kZWZpbmVkO1xuXHRcdH1cblxuXHRcdGxldCBjdXJyZW50OiBvYmplY3QgfCBudWxsID0gcGFyZW50O1xuXHRcdHdoaWxlIChjdXJyZW50KSB7XG5cdFx0XHRjb25zdCBzcGFuID0gKGN1cnJlbnQgYXMgUmVjb3JkPHN5bWJvbCwgdW5rbm93bj4pW1N5bWJvbFBhcmVudFNwYW5dIGFzIFNwYW4gfCB1bmRlZmluZWQ7XG5cdFx0XHRpZiAoc3Bhbikge1xuXHRcdFx0XHRyZXR1cm4gc3Bhbjtcblx0XHRcdH1cblx0XHRcdGN1cnJlbnQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudCk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHVuZGVmaW5lZDtcblx0fVxufVxuIl19