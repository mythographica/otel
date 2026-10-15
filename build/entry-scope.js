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
import { context as otelContext, trace, SpanStatusCode, } from '@opentelemetry/api';
const failSpan = (span, error) => {
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
        span.recordException(error);
    }
    else {
        span.setAttribute('exception.type', 'non-Error-throw');
    }
};
export function runInEntryScope(entry, deps, fn) {
    const span = deps.tracer.startSpan(entry.name);
    if (entry.attributes) {
        span.setAttributes(entry.attributes);
    }
    const activeCtx = trace.setSpan(otelContext.active(), span);
    const endOnReturn = entry.endOnReturn !== false;
    const run = () => {
        try {
            const result = deps.otel.runWithSpan(span, () => {
                const withCtx = otelContext.with(activeCtx, () => {
                    const fnResult = fn(span);
                    return fnResult;
                });
                return withCtx;
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
                void result.then(() => {
                    span.end();
                }, (error) => {
                    failSpan(span, error);
                    span.end();
                });
                return result;
            }
            span.end();
            return result;
        }
        catch (error) {
            failSpan(span, error);
            if (endOnReturn) {
                span.end();
            }
            throw error;
        }
    };
    if (deps.asyncFlow) {
        const scoped = deps.asyncFlow.runInScope(run);
        return scoped;
    }
    const direct = run();
    return direct;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50cnktc2NvcGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZW50cnktc2NvcGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILE9BQU8sRUFDTixPQUFPLElBQUksV0FBVyxFQUN0QixLQUFLLEVBQ0wsY0FBYyxHQUlkLE1BQU0sb0JBQW9CLENBQUM7QUF1QjVCLE1BQU0sUUFBUSxHQUFHLENBQUMsSUFBVSxFQUFFLEtBQWMsRUFBUSxFQUFFO0lBQ3JELElBQUksQ0FBQyxTQUFTLENBQUM7UUFDZCxJQUFJLEVBQU0sY0FBYyxDQUFDLEtBQUs7UUFDOUIsT0FBTyxFQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7S0FDaEUsQ0FBQyxDQUFDO0lBQ0gsSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM3QixDQUFDO1NBQU0sQ0FBQztRQUNQLElBQUksQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztJQUN4RCxDQUFDO0FBQ0YsQ0FBQyxDQUFDO0FBRUYsTUFBTSxVQUFVLGVBQWUsQ0FDOUIsS0FBdUIsRUFDdkIsSUFBc0IsRUFDdEIsRUFBeUI7SUFFekIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9DLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFRCxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUM1RCxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxLQUFLLEtBQUssQ0FBQztJQUVoRCxNQUFNLEdBQUcsR0FBRyxHQUFNLEVBQUU7UUFDbkIsSUFBSSxDQUFDO1lBQ0osTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtnQkFDL0MsTUFBTSxPQUFPLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsR0FBRyxFQUFFO29CQUNoRCxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQzFCLE9BQU8sUUFBUSxDQUFDO2dCQUNqQixDQUFDLENBQUMsQ0FBQztnQkFDSCxPQUFPLE9BQU8sQ0FBQztZQUNoQixDQUFDLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztnQkFDbEIsT0FBTyxNQUFNLENBQUM7WUFDZixDQUFDO1lBQ0QsK0RBQStEO1lBQy9ELDhEQUE4RDtZQUM5RCw4REFBOEQ7WUFDOUQsaUVBQWlFO1lBQ2pFLGdFQUFnRTtZQUNoRSwyREFBMkQ7WUFDM0QsSUFBSSxNQUFNLFlBQVksT0FBTyxFQUFFLENBQUM7Z0JBQy9CLHlEQUF5RDtnQkFDekQsMERBQTBEO2dCQUMxRCx5Q0FBeUM7Z0JBQ3pDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FDZixHQUFHLEVBQUU7b0JBQ0osSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUNaLENBQUMsRUFDRCxDQUFDLEtBQWMsRUFBRSxFQUFFO29CQUNsQixRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUN0QixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ1osQ0FBQyxDQUNELENBQUM7Z0JBQ0YsT0FBTyxNQUFNLENBQUM7WUFDZixDQUFDO1lBQ0QsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ1gsT0FBTyxNQUFNLENBQUM7UUFDZixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNoQixRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3RCLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2pCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNaLENBQUM7WUFDRCxNQUFNLEtBQUssQ0FBQztRQUNiLENBQUM7SUFDRixDQUFDLENBQUM7SUFFRixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNwQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM5QyxPQUFPLE1BQU0sQ0FBQztJQUNmLENBQUM7SUFDRCxNQUFNLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQztJQUNyQixPQUFPLE1BQU0sQ0FBQztBQUNmLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEVudHJ5IHNjb3BlIOKAlCB0aGUgbmV1dHJhbCBib3VuZGFyeSBmb3IgYW55IHVuaXQgb2Ygd29yazogYW4gSFRUUFxuICogcmVxdWVzdCwgYSBxdWV1ZSBtZXNzYWdlLCBhIENMSSBjb21tYW5kLCBhIHRlc3QuIEZyYW1ld29yayB3aXJpbmcgaXMgYVxuICogZmV3IGxpbmVzIG9uIHRvcCAocmVjaXBlcyBpbiB0aGUgUkVBRE1FKTsgdGhpcyBjb3JlIHN0YXlzXG4gKiBmcmFtZXdvcmstYWdub3N0aWMg4oCUIG5vIHJlcS9yZXMgc2hhcGVzIGFueXdoZXJlLlxuICpcbiAqIHJ1bkluRW50cnlTY29wZSBvcGVucyBPTkUgcm9vdCBzcGFuIG5hbWVkIGVudHJ5Lm5hbWUsIG1ha2VzIGl0IGN1cnJlbnRcbiAqIGZvciBCT1RIIHRoZSBtbmVtb25pY2EgcHJvdmlkZXIncyBzdG9yZSAob3RlbC5ydW5XaXRoU3BhbiDigJQgd2hhdFxuICogTW5lbW9uaWNhT3RlbFByb3ZpZGVyJ3MgY29uc3RydWN0aW9uIHNwYW5zIGxvb2sgdXApIEFORCB0aGUgT1RlbCBnbG9iYWxcbiAqIGNvbnRleHQgKHdoYXQgRGl2ZU90ZWxQcm92aWRlciBhZG9wdHMgYXQgYm91bmRhcmllcyksIGFuZCBvcGVucyB0aGVcbiAqIGFzeW5jLWZsb3cgcm9vdCBmcmFtZSB3aGVuIGFuIEFzeW5jRmxvd1Byb3ZpZGVyIGlzIGdpdmVuIChldmVyeSBhc3luY1xuICogaG9wIG9mIHRoZSBlbnRyeSBpbmhlcml0cyBpdCB2aWEgQUxTIHByb3BhZ2F0aW9uKS5cbiAqXG4gKiBMaWZldGltZTogYnkgZGVmYXVsdCB0aGUgc3BhbiBlbmRzIHdoZW4gZm4gcmV0dXJucywgb3Ig4oCUIHdoZW4gZm5cbiAqIHJldHVybnMgYSBuYXRpdmUgUHJvbWlzZSDigJQgd2hlbiB0aGF0IHByb21pc2Ugc2V0dGxlczsgYSB0aHJvdyBvciBhXG4gKiByZWplY3Rpb24gc2V0cyB0aGUgc3BhbidzIGVycm9yIHN0YXR1cywgcmVjb3JkcyB0aGUgZXhjZXB0aW9uLCB0aGVuXG4gKiByZXRocm93cy4gTm9uLW5hdGl2ZSB0aGVuYWJsZXMgYXJlIHBsYWluIHZhbHVlcyAobmV2ZXIgdG91Y2hlZCk6IHJldHVyblxuICogYSBuYXRpdmUgcHJvbWlzZSAoYW4gYXN5bmMgZnVuY3Rpb24pIGlmIHRoZSBzcGFuIHNob3VsZCBjb3ZlciB0aGUgYXN5bmNcbiAqIHdvcmsuIFdpdGggZW5kT25SZXR1cm46IGZhbHNlIHRoZSBjYWxsZXIgb3ducyB0aGUgZW5kaW5nIChlLmcuIGFuIEhUVFBcbiAqIHJlY2lwZSBlbmRzIHRoZSBzcGFuIG9uIHJlc3BvbnNlIGZpbmlzaCkuIGZuIHJlY2VpdmVzIHRoZSBzcGFuIGFuZCBpdHNcbiAqIHJlc3VsdCBwYXNzZXMgdGhyb3VnaCB1bmNoYW5nZWQuXG4gKi9cbmltcG9ydCB7XG5cdGNvbnRleHQgYXMgb3RlbENvbnRleHQsXG5cdHRyYWNlLFxuXHRTcGFuU3RhdHVzQ29kZSxcblx0dHlwZSBBdHRyaWJ1dGVzLFxuXHR0eXBlIFNwYW4sXG5cdHR5cGUgVHJhY2VyLFxufSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHR5cGUgeyBNbmVtb25pY2FPdGVsUHJvdmlkZXIgfSBmcm9tICcuL3Byb3ZpZGVycy9tbmVtb25pY2Etb3RlbC5wcm92aWRlci5qcyc7XG5pbXBvcnQgdHlwZSB7IEFzeW5jRmxvd1Byb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci5qcyc7XG5cbi8qKiBUaGUgcHJvdmlkZXJzIHRoZSBlbnRyeSBzY29wZSBkcml2ZXMg4oCUIHRoZSBzYW1lIHRyaW8gdGhlIEhUVFAgc2NvcGUgdG9vay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRW50cnlTY29wZURlcHMge1xuXHR0cmFjZXIgICAgIDogVHJhY2VyO1xuXHRvdGVsICAgICAgIDogTW5lbW9uaWNhT3RlbFByb3ZpZGVyO1xuXHRhc3luY0Zsb3c/IDogQXN5bmNGbG93UHJvdmlkZXI7XG59XG5cbi8qKiBXaGF0IHRvIG9wZW46IHRoZSBzcGFuIG5hbWUsIG9wdGlvbmFsIHN0YXJ0aW5nIGF0dHJpYnV0ZXMsIGxpZmV0aW1lLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFbnRyeURlZmluaXRpb24ge1xuXHRuYW1lICAgICAgICA6IHN0cmluZztcblx0YXR0cmlidXRlcz8gOiBBdHRyaWJ1dGVzO1xuXHQvKipcblx0ICogZmFsc2Ug4oaSIHRoZSBjYWxsZXIgZW5kcyB0aGUgc3BhbiAoc3Bhbi5lbmQoKSB3aGVuIHRoZSB1bml0IG9mIHdvcmtcblx0ICogdHJ1bHkgY29tcGxldGVzIOKAlCBhIHJlc3BvbnNlICdmaW5pc2gnLCBhIHNldHRsZW1lbnQgdGhlIGVudHJ5IGRvZXNcblx0ICogbm90IHNlZSkuIERlZmF1bHQgdHJ1ZTogZW5kIHdoZW4gZm4gcmV0dXJucyBvciBpdHMgcHJvbWlzZSBzZXR0bGVzLlxuXHQgKi9cblx0ZW5kT25SZXR1cm4/IDogYm9vbGVhbjtcbn1cblxuY29uc3QgZmFpbFNwYW4gPSAoc3BhbjogU3BhbiwgZXJyb3I6IHVua25vd24pOiB2b2lkID0+IHtcblx0c3Bhbi5zZXRTdGF0dXMoe1xuXHRcdGNvZGUgICAgOiBTcGFuU3RhdHVzQ29kZS5FUlJPUixcblx0XHRtZXNzYWdlIDogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuXHR9KTtcblx0aWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRzcGFuLnJlY29yZEV4Y2VwdGlvbihlcnJvcik7XG5cdH0gZWxzZSB7XG5cdFx0c3Bhbi5zZXRBdHRyaWJ1dGUoJ2V4Y2VwdGlvbi50eXBlJywgJ25vbi1FcnJvci10aHJvdycpO1xuXHR9XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gcnVuSW5FbnRyeVNjb3BlPFQ+IChcblx0ZW50cnkgOiBFbnRyeURlZmluaXRpb24sXG5cdGRlcHMgIDogRW50cnlTY29wZURlcHMsXG5cdGZuICAgIDogKHNwYW46IFNwYW4pID0+IFQsXG4pOiBUIHtcblx0Y29uc3Qgc3BhbiA9IGRlcHMudHJhY2VyLnN0YXJ0U3BhbihlbnRyeS5uYW1lKTtcblx0aWYgKGVudHJ5LmF0dHJpYnV0ZXMpIHtcblx0XHRzcGFuLnNldEF0dHJpYnV0ZXMoZW50cnkuYXR0cmlidXRlcyk7XG5cdH1cblxuXHRjb25zdCBhY3RpdmVDdHggPSB0cmFjZS5zZXRTcGFuKG90ZWxDb250ZXh0LmFjdGl2ZSgpLCBzcGFuKTtcblx0Y29uc3QgZW5kT25SZXR1cm4gPSBlbnRyeS5lbmRPblJldHVybiAhPT0gZmFsc2U7XG5cblx0Y29uc3QgcnVuID0gKCk6IFQgPT4ge1xuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCByZXN1bHQgPSBkZXBzLm90ZWwucnVuV2l0aFNwYW4oc3BhbiwgKCkgPT4ge1xuXHRcdFx0XHRjb25zdCB3aXRoQ3R4ID0gb3RlbENvbnRleHQud2l0aChhY3RpdmVDdHgsICgpID0+IHtcblx0XHRcdFx0XHRjb25zdCBmblJlc3VsdCA9IGZuKHNwYW4pO1xuXHRcdFx0XHRcdHJldHVybiBmblJlc3VsdDtcblx0XHRcdFx0fSk7XG5cdFx0XHRcdHJldHVybiB3aXRoQ3R4O1xuXHRcdFx0fSk7XG5cdFx0XHRpZiAoIWVuZE9uUmV0dXJuKSB7XG5cdFx0XHRcdHJldHVybiByZXN1bHQ7XG5cdFx0XHR9XG5cdFx0XHQvLyBvbmx5IGEgTkFUSVZFIFByb21pc2UgaXMgdHJlYXRlZCBhcyBhc3luYyB3b3JrOiBhIG5vbi1uYXRpdmVcblx0XHRcdC8vIHRoZW5hYmxlIChlLmcuIGEgbGF6eSBxdWVyeSBidWlsZGVyIHRoYXQgc3RhcnRzIGl0cyB3b3JrIG9uXG5cdFx0XHQvLyBldmVyeSB0aGVuKCkgY2FsbCkgbXVzdCBuZXZlciBiZSB0b3VjaGVkIGhlcmUg4oCUIGNhbGxpbmcgaXRzXG5cdFx0XHQvLyB0aGVuKCkgd291bGQgcnVuIHRoZSB3b3JrIGEgc2Vjb25kIHRpbWUgZm9yIHRoZSBjYWxsZXIuIFJldHVyblxuXHRcdFx0Ly8gYSBuYXRpdmUgcHJvbWlzZSAoYW4gYXN5bmMgZnVuY3Rpb24pIGlmIHRoZSBzcGFuIHNob3VsZCBjb3ZlclxuXHRcdFx0Ly8gdGhlIGFzeW5jIHdvcms7IGFueSBvdGhlciB2YWx1ZSBlbmRzIHRoZSBzcGFuIG9uIHJldHVybi5cblx0XHRcdGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG5cdFx0XHRcdC8vIHNpZGUgY2hhaW4gT05MWTogdGhlIGhhbmRsZXJzIHRvdWNoIHRoZSBzcGFuIGFuZCBuZXZlclxuXHRcdFx0XHQvLyByZXRocm93LCBzbyB0aGlzIGNyZWF0ZXMgbm8gZXh0cmEgdW5oYW5kbGVkIHJlamVjdGlvbiDigJRcblx0XHRcdFx0Ly8gZm4ncyBvd24gcHJvbWlzZSBpcyByZXR1cm5lZCB1bmNoYW5nZWRcblx0XHRcdFx0dm9pZCByZXN1bHQudGhlbihcblx0XHRcdFx0XHQoKSA9PiB7XG5cdFx0XHRcdFx0XHRzcGFuLmVuZCgpO1xuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0KGVycm9yOiB1bmtub3duKSA9PiB7XG5cdFx0XHRcdFx0XHRmYWlsU3BhbihzcGFuLCBlcnJvcik7XG5cdFx0XHRcdFx0XHRzcGFuLmVuZCgpO1xuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdCk7XG5cdFx0XHRcdHJldHVybiByZXN1bHQ7XG5cdFx0XHR9XG5cdFx0XHRzcGFuLmVuZCgpO1xuXHRcdFx0cmV0dXJuIHJlc3VsdDtcblx0XHR9IGNhdGNoIChlcnJvcikge1xuXHRcdFx0ZmFpbFNwYW4oc3BhbiwgZXJyb3IpO1xuXHRcdFx0aWYgKGVuZE9uUmV0dXJuKSB7XG5cdFx0XHRcdHNwYW4uZW5kKCk7XG5cdFx0XHR9XG5cdFx0XHR0aHJvdyBlcnJvcjtcblx0XHR9XG5cdH07XG5cblx0aWYgKGRlcHMuYXN5bmNGbG93KSB7XG5cdFx0Y29uc3Qgc2NvcGVkID0gZGVwcy5hc3luY0Zsb3cucnVuSW5TY29wZShydW4pO1xuXHRcdHJldHVybiBzY29wZWQ7XG5cdH1cblx0Y29uc3QgZGlyZWN0ID0gcnVuKCk7XG5cdHJldHVybiBkaXJlY3Q7XG59XG4iXX0=