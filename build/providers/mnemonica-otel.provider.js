/**
 * OpenTelemetry provider for mnemonica lifecycle hooks.
 *
 * Creates spans for preCreation / postCreation / creationError,
 * parents them along the prototype chain, and propagates
 * context via AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { trace, context as otelContext, } from '@opentelemetry/api';
import { getProps, } from 'mnemonica/module';
const SymbolParentSpan = Symbol.for('mnemonica.span.parent');
const asyncStorage = new AsyncLocalStorage();
export class MnemonicaOtelProvider {
    tracer;
    // spans of constructions in flight, keyed on the per-call args array
    // (the only value core guarantees identical between pre and post hooks)
    pendingSpans = new WeakMap();
    constructor(tracer) {
        this.tracer = tracer ?? trace.getTracer('@mnemonica/otel');
    }
    getCurrentSpan() {
        const store = asyncStorage.getStore();
        return store;
    }
    runWithSpan(span, fn) {
        const result = asyncStorage.run(span, fn);
        return result;
    }
    attachHooks(collection) {
        collection.registerHook('preCreation', (hookData) => {
            const parentSpan = this.findParentSpan(hookData);
            const ctx = parentSpan
                ? trace.setSpan(otelContext.active(), parentSpan)
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
            const args = getProps(current)?.__args__;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcHJvdmlkZXJzL21uZW1vbmljYS1vdGVsLnByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUNILE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUNoRCxPQUFPLEVBQ04sS0FBSyxFQUNMLE9BQU8sSUFBSSxXQUFXLEdBR3RCLE1BQU0sb0JBQW9CLENBQUM7QUFDNUIsT0FBTyxFQUNOLFFBQVEsR0FHUixNQUFNLGtCQUFrQixDQUFDO0FBRTFCLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBQzdELE1BQU0sWUFBWSxHQUFHLElBQUksaUJBQWlCLEVBQVEsQ0FBQztBQUVuRCxNQUFNLE9BQU8scUJBQXFCO0lBQ3pCLE1BQU0sQ0FBUztJQUN2QixxRUFBcUU7SUFDckUsd0VBQXdFO0lBQ2hFLFlBQVksR0FBRyxJQUFJLE9BQU8sRUFBZ0IsQ0FBQztJQUVuRCxZQUFhLE1BQWU7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRCxjQUFjO1FBQ2IsTUFBTSxLQUFLLEdBQUcsWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3RDLE9BQU8sS0FBSyxDQUFDO0lBQ2QsQ0FBQztJQUVELFdBQVcsQ0FBSyxJQUFVLEVBQUUsRUFBVztRQUN0QyxNQUFNLE1BQU0sR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMxQyxPQUFPLE1BQU0sQ0FBQztJQUNmLENBQUM7SUFFRCxXQUFXLENBQUUsVUFBMkI7UUFDdkMsVUFBVSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxRQUFtQixF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QUFJLE9BQW1DLENBQUUsZ0JBQWdCLENBQXNCLENBQUM7WUFDMUYsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDVixPQUFPLElBQUksQ0FBQztZQUNiLENBQUM7WUFDRCwrREFBK0Q7WUFDL0QsbUVBQW1FO1lBQ25FLGtFQUFrRTtZQUNsRSxnRUFBZ0U7WUFDaEUsNkRBQTZEO1lBQzdELGdEQUFnRDtZQUNoRCxNQUFNLElBQUksR0FBSSxRQUFRLENBQUMsT0FBTyxDQUF3QyxFQUFFLFFBQVEsQ0FBQztZQUNqRixJQUFJLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQzVDLElBQUksT0FBTyxFQUFFLENBQUM7b0JBQ2IsT0FBTyxPQUFPLENBQUM7Z0JBQ2hCLENBQUM7WUFDRixDQUFDO1lBQ0QsT0FBTyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDMUMsQ0FBQztRQUVELE9BQU8sU0FBUyxDQUFDO0lBQ2xCLENBQUM7Q0FDRCIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT3BlblRlbGVtZXRyeSBwcm92aWRlciBmb3IgbW5lbW9uaWNhIGxpZmVjeWNsZSBob29rcy5cbiAqXG4gKiBDcmVhdGVzIHNwYW5zIGZvciBwcmVDcmVhdGlvbiAvIHBvc3RDcmVhdGlvbiAvIGNyZWF0aW9uRXJyb3IsXG4gKiBwYXJlbnRzIHRoZW0gYWxvbmcgdGhlIHByb3RvdHlwZSBjaGFpbiwgYW5kIHByb3BhZ2F0ZXNcbiAqIGNvbnRleHQgdmlhIEFzeW5jTG9jYWxTdG9yYWdlLlxuICovXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ2FzeW5jX2hvb2tzJztcbmltcG9ydCB7XG5cdHRyYWNlLFxuXHRjb250ZXh0IGFzIG90ZWxDb250ZXh0LFxuXHR0eXBlIFRyYWNlcixcblx0dHlwZSBTcGFuLFxufSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHtcblx0Z2V0UHJvcHMsXG5cdHR5cGUgaG9va3NPcHRzLFxuXHR0eXBlIFR5cGVzQ29sbGVjdGlvbixcbn0gZnJvbSAnbW5lbW9uaWNhL21vZHVsZSc7XG5cbmNvbnN0IFN5bWJvbFBhcmVudFNwYW4gPSBTeW1ib2wuZm9yKCdtbmVtb25pY2Euc3Bhbi5wYXJlbnQnKTtcbmNvbnN0IGFzeW5jU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZTxTcGFuPigpO1xuXG5leHBvcnQgY2xhc3MgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIHtcblx0cHJpdmF0ZSB0cmFjZXI6IFRyYWNlcjtcblx0Ly8gc3BhbnMgb2YgY29uc3RydWN0aW9ucyBpbiBmbGlnaHQsIGtleWVkIG9uIHRoZSBwZXItY2FsbCBhcmdzIGFycmF5XG5cdC8vICh0aGUgb25seSB2YWx1ZSBjb3JlIGd1YXJhbnRlZXMgaWRlbnRpY2FsIGJldHdlZW4gcHJlIGFuZCBwb3N0IGhvb2tzKVxuXHRwcml2YXRlIHBlbmRpbmdTcGFucyA9IG5ldyBXZWFrTWFwPG9iamVjdCwgU3Bhbj4oKTtcblxuXHRjb25zdHJ1Y3RvciAodHJhY2VyPzogVHJhY2VyKSB7XG5cdFx0dGhpcy50cmFjZXIgPSB0cmFjZXIgPz8gdHJhY2UuZ2V0VHJhY2VyKCdAbW5lbW9uaWNhL290ZWwnKTtcblx0fVxuXG5cdGdldEN1cnJlbnRTcGFuICgpOiBTcGFuIHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBzdG9yZSA9IGFzeW5jU3RvcmFnZS5nZXRTdG9yZSgpO1xuXHRcdHJldHVybiBzdG9yZTtcblx0fVxuXG5cdHJ1bldpdGhTcGFuPFQ+IChzcGFuOiBTcGFuLCBmbjogKCkgPT4gVCk6IFQge1xuXHRcdGNvbnN0IHJlc3VsdCA9IGFzeW5jU3RvcmFnZS5ydW4oc3BhbiwgZm4pO1xuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHRhdHRhY2hIb29rcyAoY29sbGVjdGlvbjogVHlwZXNDb2xsZWN0aW9uKTogdm9pZCB7XG5cdFx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3ByZUNyZWF0aW9uJywgKGhvb2tEYXRhOiBob29rc09wdHMpID0+IHtcblx0XHRcdGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmZpbmRQYXJlbnRTcGFuKGhvb2tEYXRhKTtcblx0XHRcdGNvbnN0IGN0eCA9IHBhcmVudFNwYW5cblx0XHRcdFx0PyB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBwYXJlbnRTcGFuKVxuXHRcdFx0XHQ6IHVuZGVmaW5lZDtcblx0XHRcdGNvbnN0IHNwYW4gPSBwYXJlbnRTcGFuXG5cdFx0XHRcdD8gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuXHRcdFx0XHRcdGBtbmVtb25pY2EuJHtob29rRGF0YS5UeXBlTmFtZX1gLFxuXHRcdFx0XHRcdHt9LFxuXHRcdFx0XHRcdGN0eFxuXHRcdFx0XHQpXG5cdFx0XHRcdDogdGhpcy50cmFjZXIuc3RhcnRTcGFuKGBtbmVtb25pY2EuJHtob29rRGF0YS5UeXBlTmFtZX1gKTtcblxuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ21uZW1vbmljYS50eXBlX25hbWUnLCBob29rRGF0YS5UeXBlTmFtZSk7XG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLmhvb2snLCAncHJlQ3JlYXRpb24nKTtcblxuXHRcdFx0Ly8gU3RvcmUgdGhlIHBlbmRpbmcgc3BhbiBrZXllZCBvbiB0aGUgY29uc3RydWN0aW9uJ3MgYXJncyBhcnJheTpcblx0XHRcdC8vIGNvcmUgcGFzc2VzIHRoZSBpZGVudGljYWwgYXJncyByZWZlcmVuY2UgdG8gcHJlQ3JlYXRpb24gYW5kIHRvXG5cdFx0XHQvLyBwb3N0Q3JlYXRpb24vY3JlYXRpb25FcnJvciwgYW5kIGl0IGlzIHVuaXF1ZSBwZXIgY29uc3RydWN0aW9uIGNhbGwuXG5cdFx0XHQvLyBLZXlpbmcgb24gdGhlIHBhcmVudCBpbnN0YW5jZSB3b3VsZCBjb2xsaWRlIHdoZW4gYXN5bmMgY29uc3RydWN0aW9uc1xuXHRcdFx0Ly8gb2Ygc2libGluZ3MgaW50ZXJsZWF2ZSAocHJlQSwgcHJlQiwgcG9zdEIsIHBvc3RBIOKAlCB0aGUgc2Vjb25kXG5cdFx0XHQvLyBwcmVDcmVhdGlvbiB3b3VsZCBvdmVyd3JpdGUgdGhlIGZpcnN0KS5cblx0XHRcdHRoaXMucGVuZGluZ1NwYW5zLnNldChob29rRGF0YS5hcmdzLCBzcGFuKTtcblx0XHR9KTtcblxuXHRcdGNvbGxlY3Rpb24ucmVnaXN0ZXJIb29rKCdwb3N0Q3JlYXRpb24nLCAoaG9va0RhdGE6IGhvb2tzT3B0cykgPT4ge1xuXHRcdFx0Y29uc3QgbmV3SW5zdGFuY2UgPSBob29rRGF0YS5pbmhlcml0ZWRJbnN0YW5jZTtcblx0XHRcdGlmIChuZXdJbnN0YW5jZSA9PSBudWxsIHx8IHR5cGVvZiBuZXdJbnN0YW5jZSAhPT0gJ29iamVjdCcpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBSZXRyaWV2ZSBhbmQgcmVtb3ZlIHRoZSBwZW5kaW5nIHNwYW4gZm9yIHRoaXMgY29uc3RydWN0aW9uXG5cdFx0XHRsZXQgc3BhbiA9IHRoaXMucGVuZGluZ1NwYW5zLmdldChob29rRGF0YS5hcmdzKTtcblx0XHRcdHRoaXMucGVuZGluZ1NwYW5zLmRlbGV0ZShob29rRGF0YS5hcmdzKTtcblxuXHRcdFx0aWYgKCFzcGFuKSB7XG5cdFx0XHRcdC8vIEZhbGxiYWNrOiBjcmVhdGUgc3BhbiBoZXJlIGlmIHByZUNyZWF0aW9uIGRpZG4ndCAoc2hvdWxkbid0IGhhcHBlbilcblx0XHRcdFx0c3BhbiA9IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihgbW5lbW9uaWNhLiR7aG9va0RhdGEuVHlwZU5hbWV9YCk7XG5cdFx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EudHlwZV9uYW1lJywgaG9va0RhdGEuVHlwZU5hbWUpO1xuXHRcdFx0fVxuXG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLmhvb2snLCAncG9zdENyZWF0aW9uJyk7XG5cdFx0XHRzcGFuLmVuZCgpO1xuXG5cdFx0XHQvLyBTdG9yZSBvbiBuZXcgaW5zdGFuY2Ugc28gaXRzIGNoaWxkcmVuIGNhbiBmaW5kIHRoZSBwYXJlbnQgc3BhblxuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5ld0luc3RhbmNlLCBTeW1ib2xQYXJlbnRTcGFuLCB7XG5cdFx0XHRcdHZhbHVlICAgICAgICA6IHNwYW4sXG5cdFx0XHRcdGNvbmZpZ3VyYWJsZSA6IHRydWUsXG5cdFx0XHRcdGVudW1lcmFibGUgICA6IGZhbHNlLFxuXHRcdFx0XHR3cml0YWJsZSAgICAgOiB0cnVlLFxuXHRcdFx0fSk7XG5cdFx0fSk7XG5cblx0XHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygnY3JlYXRpb25FcnJvcicsIChob29rRGF0YTogaG9va3NPcHRzKSA9PiB7XG5cdFx0XHRjb25zdCBuZXdJbnN0YW5jZSA9IGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlO1xuXHRcdFx0aWYgKG5ld0luc3RhbmNlID09IG51bGwgfHwgdHlwZW9mIG5ld0luc3RhbmNlICE9PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdC8vIFJldHJpZXZlIGFuZCByZW1vdmUgdGhlIHBlbmRpbmcgc3BhbiBmb3IgdGhpcyBjb25zdHJ1Y3Rpb25cblx0XHRcdGxldCBzcGFuID0gdGhpcy5wZW5kaW5nU3BhbnMuZ2V0KGhvb2tEYXRhLmFyZ3MpO1xuXHRcdFx0dGhpcy5wZW5kaW5nU3BhbnMuZGVsZXRlKGhvb2tEYXRhLmFyZ3MpO1xuXG5cdFx0XHRpZiAoIXNwYW4pIHtcblx0XHRcdFx0c3BhbiA9IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihgbW5lbW9uaWNhLiR7aG9va0RhdGEuVHlwZU5hbWV9YCk7XG5cdFx0XHRcdHNwYW4uc2V0QXR0cmlidXRlKCdtbmVtb25pY2EudHlwZV9uYW1lJywgaG9va0RhdGEuVHlwZU5hbWUpO1xuXHRcdFx0fVxuXG5cdFx0XHRzcGFuLnNldEF0dHJpYnV0ZSgnbW5lbW9uaWNhLmhvb2snLCAnY3JlYXRpb25FcnJvcicpO1xuXHRcdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2Vycm9yLnR5cGUnLCAnRXJyb3InKTtcblx0XHRcdHNwYW4ucmVjb3JkRXhjZXB0aW9uKG5ld0luc3RhbmNlIGFzIEVycm9yKTtcblx0XHRcdHNwYW4uZW5kKCk7XG5cblx0XHRcdC8vIFN0b3JlIG9uIGVycm9yIGluc3RhbmNlIGZvciBjaGFpbiB0cmFjaW5nXG5cdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkobmV3SW5zdGFuY2UsIFN5bWJvbFBhcmVudFNwYW4sIHtcblx0XHRcdFx0dmFsdWUgICAgICAgIDogc3Bhbixcblx0XHRcdFx0Y29uZmlndXJhYmxlIDogdHJ1ZSxcblx0XHRcdFx0ZW51bWVyYWJsZSAgIDogZmFsc2UsXG5cdFx0XHRcdHdyaXRhYmxlICAgICA6IHRydWUsXG5cdFx0XHR9KTtcblx0XHR9KTtcblx0fVxuXG5cdHByaXZhdGUgZmluZFBhcmVudFNwYW4gKGhvb2tEYXRhOiBob29rc09wdHMpOiBTcGFuIHwgdW5kZWZpbmVkIHtcblx0XHRjb25zdCBzdG9yZWQgPSBhc3luY1N0b3JhZ2UuZ2V0U3RvcmUoKTtcblx0XHRpZiAoc3RvcmVkKSB7XG5cdFx0XHRyZXR1cm4gc3RvcmVkO1xuXHRcdH1cblxuXHRcdGNvbnN0IHBhcmVudCA9IGhvb2tEYXRhLmV4aXN0ZW50SW5zdGFuY2U7XG5cdFx0aWYgKHBhcmVudCA9PSBudWxsIHx8IHR5cGVvZiBwYXJlbnQgIT09ICdvYmplY3QnKSB7XG5cdFx0XHRyZXR1cm4gdW5kZWZpbmVkO1xuXHRcdH1cblxuXHRcdGxldCBjdXJyZW50OiBvYmplY3QgfCBudWxsID0gcGFyZW50O1xuXHRcdHdoaWxlIChjdXJyZW50KSB7XG5cdFx0XHRjb25zdCBzcGFuID0gKGN1cnJlbnQgYXMgUmVjb3JkPHN5bWJvbCwgdW5rbm93bj4pWyBTeW1ib2xQYXJlbnRTcGFuIF0gYXMgU3BhbiB8IHVuZGVmaW5lZDtcblx0XHRcdGlmIChzcGFuKSB7XG5cdFx0XHRcdHJldHVybiBzcGFuO1xuXHRcdFx0fVxuXHRcdFx0Ly8gQW4gYW5jZXN0b3Igd2hvc2UgY29uc3RydWN0b3IgaXMgc3RpbGwgcnVubmluZyAodGhlIGNoaWxkIGlzXG5cdFx0XHQvLyBidWlsdCBpbnNpZGUgaXQsIGUuZy4gYHRoaXMua2lkID0gbmV3IHRoaXMuS2lkKClgLCBzeW5jIG9yIGFmdGVyXG5cdFx0XHQvLyBhbiBhd2FpdCkgY2FycmllcyBubyBzcGFuIHlldCDigJQgdGhhdCBsYW5kcyBhdCBpdHMgcG9zdENyZWF0aW9uLlxuXHRcdFx0Ly8gSXRzIHNwYW4gaXMgcGVuZGluZywga2V5ZWQgb24gaXRzIGFyZ3MgYXJyYXksIHdoaWNoIGNvcmUgYWxzb1xuXHRcdFx0Ly8gZXhwb3NlcyBhcyB0aGUgaW5zdGFuY2UncyBfX2FyZ3NfXzogc2FtZSByZWZlcmVuY2UsIHNvIHRoZVxuXHRcdFx0Ly8gbG9va3VwIGZvbGxvd3MgbGluZWFnZSBleGFjdGx5LCBuZXZlciB0aW1pbmcuXG5cdFx0XHRjb25zdCBhcmdzID0gKGdldFByb3BzKGN1cnJlbnQpIGFzIHsgX19hcmdzX18/OiB1bmtub3duIH0gfCB1bmRlZmluZWQpPy5fX2FyZ3NfXztcblx0XHRcdGlmIChhcmdzICYmIHR5cGVvZiBhcmdzID09PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRjb25zdCBwZW5kaW5nID0gdGhpcy5wZW5kaW5nU3BhbnMuZ2V0KGFyZ3MpO1xuXHRcdFx0XHRpZiAocGVuZGluZykge1xuXHRcdFx0XHRcdHJldHVybiBwZW5kaW5nO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRjdXJyZW50ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnQpO1xuXHRcdH1cblxuXHRcdHJldHVybiB1bmRlZmluZWQ7XG5cdH1cbn1cbiJdfQ==