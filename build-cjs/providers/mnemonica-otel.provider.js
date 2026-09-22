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
const module_1 = require("mnemonica/module");
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
            // An ancestor whose constructor is still running (the child is
            // built inside it, e.g. `this.kid = new this.Kid()`, sync or after
            // an await) carries no span yet — that lands at its postCreation.
            // Its span is pending, keyed on its args array, which core also
            // exposes as the instance's __args__: same reference, so the
            // lookup follows lineage exactly, never timing.
            const args = (0, module_1.getProps)(current)?.__args__;
            if (args && typeof args === 'object') {
                const pending = this.pendingSpans.get(args);
                if (pending) {
                    return pending;
                }
            }
            current = Object.getPrototypeOf(current);
        }
        return undefined;
    }
}
exports.MnemonicaOtelProvider = MnemonicaOtelProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcHJvdmlkZXJzL21uZW1vbmljYS1vdGVsLnByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7Ozs7R0FNRztBQUNILDZDQUFnRDtBQUVoRCw0Q0FBbUU7QUFFbkUsNkNBQTRDO0FBRTVDLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBQzdELE1BQU0sWUFBWSxHQUFHLElBQUksK0JBQWlCLEVBQVEsQ0FBQztBQUVuRCxNQUFhLHFCQUFxQjtJQUN6QixNQUFNLENBQVM7SUFDdkIscUVBQXFFO0lBQ3JFLHdFQUF3RTtJQUNoRSxZQUFZLEdBQUcsSUFBSSxPQUFPLEVBQWdCLENBQUM7SUFFbkQsWUFBYSxNQUFlO1FBQzNCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxJQUFJLFdBQUssQ0FBQyxTQUFTLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUM1RCxDQUFDO0lBRUQsY0FBYztRQUNiLE9BQU8sWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQ2hDLENBQUM7SUFFRCxXQUFXLENBQUssSUFBVSxFQUFFLEVBQVc7UUFDdEMsT0FBTyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztJQUNuQyxDQUFDO0lBRUQsV0FBVyxDQUFFLFVBQTJCO1FBQ3ZDLFVBQVUsQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUMsUUFBbUIsRUFBRSxFQUFFO1lBQzlELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDakQsTUFBTSxHQUFHLEdBQUcsVUFBVTtnQkFDckIsQ0FBQyxDQUFDLFdBQUssQ0FBQyxPQUFPLENBQUMsYUFBVyxDQUFDLE1BQU0sRUFBRSxFQUFFLFVBQVUsQ0FBQztnQkFDakQsQ0FB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TUFBTSxJQUFJLEdBQUksSUFBQSxpQkFBUSxFQUFDLE9BQU8sQ0FBd0MsRUFBRSxRQUFRLENBQUM7WUFDakYsSUFBSSxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUM1QyxJQUFJLE9BQU8sRUFBRSxDQUFDO29CQUNiLE9BQU8sT0FBTyxDQUFDO2dCQUNoQixDQUFDO1lBQ0YsQ0FBQztZQUNELE9BQU8sR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzFDLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQztJQUNsQixDQUFDO0NBQ0Q7QUF6SUQsc0RBeUlDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IHByb3ZpZGVyIGZvciBtbmVtb25pY2EgbGlmZWN5Y2xlIGhvb2tzLlxuICpcbiAqIENyZWF0ZXMgc3BhbnMgZm9yIHByZUNyZWF0aW9uIC8gcG9zdENyZWF0aW9uIC8gY3JlYXRpb25FcnJvcixcbiAqIHBhcmVudHMgdGhlbSBhbG9uZyB0aGUgcHJvdG90eXBlIGNoYWluLCBhbmQgcHJvcGFnYXRlc1xuICogY29udGV4dCB2aWEgQXN5bmNMb2NhbFN0b3JhZ2UuXG4gKi9cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnYXN5bmNfaG9va3MnO1xuaW1wb3J0IHR5cGUgeyBUcmFjZXIsIFNwYW4gfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHsgdHJhY2UsIGNvbnRleHQgYXMgb3RlbENvbnRleHQgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHR5cGUgeyBob29rc09wdHMsIFR5cGVzQ29sbGVjdGlvbiB9IGZyb20gJ21uZW1vbmljYS9tb2R1bGUnO1xuaW1wb3J0IHsgZ2V0UHJvcHMgfSBmcm9tICdtbmVtb25pY2EvbW9kdWxlJztcblxuY29uc3QgU3ltYm9sUGFyZW50U3BhbiA9IFN5bWJvbC5mb3IoJ21uZW1vbmljYS5zcGFuLnBhcmVudCcpO1xuY29uc3QgYXN5bmNTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPFNwYW4+KCk7XG5cbmV4cG9ydCBjbGFzcyBNbmVtb25pY2FPdGVsUHJvdmlkZXIge1xuXHRwcml2YXRlIHRyYWNlcjogVHJhY2VyO1xuXHQvLyBzcGFucyBvZiBjb25zdHJ1Y3Rpb25zIGluIGZsaWdodCwga2V5ZWQgb24gdGhlIHBlci1jYWxsIGFyZ3MgYXJyYXlcblx0Ly8gKHRoZSBvbmx5IHZhbHVlIGNvcmUgZ3VhcmFudGVlcyBpZGVudGljYWwgYmV0d2VlbiBwcmUgYW5kIHBvc3QgaG9va3MpXG5cdHByaXZhdGUgcGVuZGluZ1NwYW5zID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBTcGFuPigpO1xuXG5cdGNvbnN0cnVjdG9yICh0cmFjZXI/OiBUcmFjZXIpIHtcblx0XHR0aGlzLnRyYWNlciA9IHRyYWNlciA/PyB0cmFjZS5nZXRUcmFjZXIoJ0BtbmVtb25pY2Evb3RlbCcpO1xuXHR9XG5cblx0Z2V0Q3VycmVudFNwYW4gKCk6IFNwYW4gfCB1bmRlZmluZWQge1xuXHRcdHJldHVybiBhc3luY1N0b3JhZ2UuZ2V0U3RvcmUoKTtcblx0fVxuXG5cdHJ1bldpdGhTcGFuPFQ+IChzcGFuOiBTcGFuLCBmbjogKCkgPT4gVCk6IFQge1xuXHRcdHJldHVybiBhc3luY1N0b3JhZ2UucnVuKHNwYW4sIGZuKTtcblx0fVxuXG5cdGF0dGFjaEhvb2tzIChjb2xsZWN0aW9uOiBUeXBlc0NvbGxlY3Rpb24pOiB2b2lkIHtcblx0XHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygncHJlQ3JlYXRpb24nLCAoaG9va0RhdGE6IGhvb2tzT3B0cykgPT4ge1xuXHRcdFx0Y29uc3QgcGFyZW50U3BhbiA9IHRoaXMuZmluZFBhcmVudFNwYW4oaG9va0RhdGEpO1xuXHRcdFx0Y29uc3QgY3R4ID0gcGFyZW50U3BhblxuXHRcdFx0XHQ/IHRyYWNlLnNldFNwYW4ob3RlbENvbnRleHQuYWN0aXZlKCksIHBhcmVudFNwYW4pXG5cdFx0XHRcdDogdW5kZWZpbmVkO1xuXHRcdFx0Y29uc3Qgc3BhbiA9IHBhcmVudFNwYW5cblx0XHRcdFx0PyB0aGlzLnRyYWNlci5zdGFydFNwYW4oXG5cdFx0XHRcdFx0YG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWAsXG5cdFx0XHRcdFx0e30sXG5cdFx0XHRcdFx0Y3R4XG5cdFx0XHRcdClcblx0XHRcdFx0OiB0aGlzLnRyYWNlci5zdGFydFNwYW4oYG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWApO1xuXG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLnR5cGVfbmFtZScsIGhvb2tEYXRhLlR5cGVOYW1lKTtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EuaG9vaycsICdwcmVDcmVhdGlvbicpO1xuXG5cdFx0XHQvLyBTdG9yZSB0aGUgcGVuZGluZyBzcGFuIGtleWVkIG9uIHRoZSBjb25zdHJ1Y3Rpb24ncyBhcmdzIGFycmF5OlxuXHRcdFx0Ly8gY29yZSBwYXNzZXMgdGhlIGlkZW50aWNhbCBhcmdzIHJlZmVyZW5jZSB0byBwcmVDcmVhdGlvbiBhbmQgdG9cblx0XHRcdC8vIHBvc3RDcmVhdGlvbi9jcmVhdGlvbkVycm9yLCBhbmQgaXQgaXMgdW5pcXVlIHBlciBjb25zdHJ1Y3Rpb24gY2FsbC5cblx0XHRcdC8vIEtleWluZyBvbiB0aGUgcGFyZW50IGluc3RhbmNlIHdvdWxkIGNvbGxpZGUgd2hlbiBhc3luYyBjb25zdHJ1Y3Rpb25zXG5cdFx0XHQvLyBvZiBzaWJsaW5ncyBpbnRlcmxlYXZlIChwcmVBLCBwcmVCLCBwb3N0QiwgcG9zdEEg4oCUIHRoZSBzZWNvbmRcblx0XHRcdC8vIHByZUNyZWF0aW9uIHdvdWxkIG92ZXJ3cml0ZSB0aGUgZmlyc3QpLlxuXHRcdFx0dGhpcy5wZW5kaW5nU3BhbnMuc2V0KGhvb2tEYXRhLmFyZ3MsIHNwYW4pO1xuXHRcdH0pO1xuXG5cdFx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3Bvc3RDcmVhdGlvbicsIChob29rRGF0YTogaG9va3NPcHRzKSA9PiB7XG5cdFx0XHRjb25zdCBuZXdJbnN0YW5jZSA9IGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlO1xuXHRcdFx0aWYgKG5ld0luc3RhbmNlID09IG51bGwgfHwgdHlwZW9mIG5ld0luc3RhbmNlICE9PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdC8vIFJldHJpZXZlIGFuZCByZW1vdmUgdGhlIHBlbmRpbmcgc3BhbiBmb3IgdGhpcyBjb25zdHJ1Y3Rpb25cblx0XHRcdGxldCBzcGFuID0gdGhpcy5wZW5kaW5nU3BhbnMuZ2V0KGhvb2tEYXRhLmFyZ3MpO1xuXHRcdFx0dGhpcy5wZW5kaW5nU3BhbnMuZGVsZXRlKGhvb2tEYXRhLmFyZ3MpO1xuXG5cdFx0XHRpZiAoIXNwYW4pIHtcblx0XHRcdFx0Ly8gRmFsbGJhY2s6IGNyZWF0ZSBzcGFuIGhlcmUgaWYgcHJlQ3JlYXRpb24gZGlkbid0IChzaG91bGRuJ3QgaGFwcGVuKVxuXHRcdFx0XHRzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKGBtbmVtb25pY2EuJHtob29rRGF0YS5UeXBlTmFtZX1gKTtcblx0XHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ21uZW1vbmljYS50eXBlX25hbWUnLCBob29rRGF0YS5UeXBlTmFtZSk7XG5cdFx0XHR9XG5cblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EuaG9vaycsICdwb3N0Q3JlYXRpb24nKTtcblx0XHRcdHNwYW4uZW5kKCk7XG5cblx0XHRcdC8vIFN0b3JlIG9uIG5ldyBpbnN0YW5jZSBzbyBpdHMgY2hpbGRyZW4gY2FuIGZpbmQgdGhlIHBhcmVudCBzcGFuXG5cdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkobmV3SW5zdGFuY2UsIFN5bWJvbFBhcmVudFNwYW4sIHtcblx0XHRcdFx0dmFsdWUgICAgICAgOiBzcGFuLFxuXHRcdFx0XHRjb25maWd1cmFibGU6IHRydWUsXG5cdFx0XHRcdGVudW1lcmFibGUgIDogZmFsc2UsXG5cdFx0XHRcdHdyaXRhYmxlICAgIDogdHJ1ZSxcblx0XHRcdH0pO1xuXHRcdH0pO1xuXG5cdFx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ2NyZWF0aW9uRXJyb3InLCAoaG9va0RhdGE6IGhvb2tzT3B0cykgPT4ge1xuXHRcdFx0Y29uc3QgbmV3SW5zdGFuY2UgPSBob29rRGF0YS5pbmhlcml0ZWRJbnN0YW5jZTtcblx0XHRcdGlmIChuZXdJbnN0YW5jZSA9PSBudWxsIHx8IHR5cGVvZiBuZXdJbnN0YW5jZSAhPT0gJ29iamVjdCcpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBSZXRyaWV2ZSBhbmQgcmVtb3ZlIHRoZSBwZW5kaW5nIHNwYW4gZm9yIHRoaXMgY29uc3RydWN0aW9uXG5cdFx0XHRsZXQgc3BhbiA9IHRoaXMucGVuZGluZ1NwYW5zLmdldChob29rRGF0YS5hcmdzKTtcblx0XHRcdHRoaXMucGVuZGluZ1NwYW5zLmRlbGV0ZShob29rRGF0YS5hcmdzKTtcblxuXHRcdFx0aWYgKCFzcGFuKSB7XG5cdFx0XHRcdHNwYW4gPSB0aGlzLnRyYWNlci5zdGFydFNwYW4oYG1uZW1vbmljYS4ke2hvb2tEYXRhLlR5cGVOYW1lfWApO1xuXHRcdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLnR5cGVfbmFtZScsIGhvb2tEYXRhLlR5cGVOYW1lKTtcblx0XHRcdH1cblxuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ21uZW1vbmljYS5ob29rJywgJ2NyZWF0aW9uRXJyb3InKTtcblx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdlcnJvci50eXBlJywgJ0Vycm9yJyk7XG5cdFx0XHRzcGFuLnJlY29yZEV4Y2VwdGlvbihuZXdJbnN0YW5jZSBhcyBFcnJvcik7XG5cdFx0XHRzcGFuLmVuZCgpO1xuXG5cdFx0XHQvLyBTdG9yZSBvbiBlcnJvciBpbnN0YW5jZSBmb3IgY2hhaW4gdHJhY2luZ1xuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5ld0luc3RhbmNlLCBTeW1ib2xQYXJlbnRTcGFuLCB7XG5cdFx0XHRcdHZhbHVlICAgICAgIDogc3Bhbixcblx0XHRcdFx0Y29uZmlndXJhYmxlOiB0cnVlLFxuXHRcdFx0XHRlbnVtZXJhYmxlICA6IGZhbHNlLFxuXHRcdFx0XHR3cml0YWJsZSAgICA6IHRydWUsXG5cdFx0XHR9KTtcblx0XHR9KTtcblx0fVxuXG5cdHByaXZhdGUgZmluZFBhcmVudFNwYW4gKGhvb2tEYXRhOiBob29rc09wdHMpOiBTcGFuIHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBzdG9yZWQgPSBhc3luY1N0b3JhZ2UuZ2V0U3RvcmUoKTtcblx0XHRpZiAoc3RvcmVkKSB7XG5cdFx0XHRyZXR1cm4gc3RvcmVkO1xuXHRcdH1cblxuXHRcdGNvbnN0IHBhcmVudCA9IGhvb2tEYXRhLmV4aXN0ZW50SW5zdGFuY2U7XG5cdFx0aWYgKHBhcmVudCA9PSBudWxsIHx8IHR5cGVvZiBwYXJlbnQgIT09ICdvYmplY3QnKSB7XG5cdFx0XHRyZXR1cm4gdW5kZWZpbmVkO1xuXHRcdH1cblxuXHRcdGxldCBjdXJyZW50OiBvYmplY3QgfCBudWxsID0gcGFyZW50O1xuXHRcdHdoaWxlIChjdXJyZW50KSB7XG5cdFx0XHRjb25zdCBzcGFuID0gKGN1cnJlbnQgYXMgUmVjb3JkPHN5bWJvbCwgdW5rbm93bj4pW1N5bWJvbFBhcmVudFNwYW5dIGFzIFNwYW4gfCB1bmRlZmluZWQ7XG5cdFx0XHRpZiAoc3Bhbikge1xuXHRcdFx0XHRyZXR1cm4gc3Bhbjtcblx0XHRcdH1cblx0XHRcdC8vIEFuIGFuY2VzdG9yIHdob3NlIGNvbnN0cnVjdG9yIGlzIHN0aWxsIHJ1bm5pbmcgKHRoZSBjaGlsZCBpc1xuXHRcdFx0Ly8gYnVpbHQgaW5zaWRlIGl0LCBlLmcuIGB0aGlzLmtpZCA9IG5ldyB0aGlzLktpZCgpYCwgc3luYyBvciBhZnRlclxuXHRcdFx0Ly8gYW4gYXdhaXQpIGNhcnJpZXMgbm8gc3BhbiB5ZXQg4oCUIHRoYXQgbGFuZHMgYXQgaXRzIHBvc3RDcmVhdGlvbi5cblx0XHRcdC8vIEl0cyBzcGFuIGlzIHBlbmRpbmcsIGtleWVkIG9uIGl0cyBhcmdzIGFycmF5LCB3aGljaCBjb3JlIGFsc29cblx0XHRcdC8vIGV4cG9zZXMgYXMgdGhlIGluc3RhbmNlJ3MgX19hcmdzX186IHNhbWUgcmVmZXJlbmNlLCBzbyB0aGVcblx0XHRcdC8vIGxvb2t1cCBmb2xsb3dzIGxpbmVhZ2UgZXhhY3RseSwgbmV2ZXIgdGltaW5nLlxuXHRcdFx0Y29uc3QgYXJncyA9IChnZXRQcm9wcyhjdXJyZW50KSBhcyB7IF9fYXJnc19fPzogdW5rbm93biB9IHwgdW5kZWZpbmVkKT8uX19hcmdzX187XG5cdFx0XHRpZiAoYXJncyAmJiB0eXBlb2YgYXJncyA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0Y29uc3QgcGVuZGluZyA9IHRoaXMucGVuZGluZ1NwYW5zLmdldChhcmdzKTtcblx0XHRcdFx0aWYgKHBlbmRpbmcpIHtcblx0XHRcdFx0XHRyZXR1cm4gcGVuZGluZztcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0Y3VycmVudCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50KTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdW5kZWZpbmVkO1xuXHR9XG59XG4iXX0=