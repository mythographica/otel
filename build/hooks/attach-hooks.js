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
import { resolveDive, } from '../dive-api.js';
// `typeof === 'function'` narrows to the banned bare Function type; this
// guard re-grounds the value to dive's AnyFn instead (never[] accepts
// every parameter list — the caller's signature is the caller's business)
const isAnyFn = (value) => {
    const result = typeof value === 'function';
    return result;
};
export function attachHooks(collection, options) {
    const dive = resolveDive(options);
    collection.registerHook('preCreation', (hookData) => {
        const parent = hookData.existentInstance;
        if (parent) {
            dive.enterContext(parent);
        }
        const { args } = hookData;
        if (Array.isArray(args)) {
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                if (isAnyFn(arg) && !dive.isWrappedFunction(arg)) {
                    args[i] = dive.wrapConstructorArg(arg, parent);
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
                dive.upgradeConstructorArg(arg, instance);
            }
        }
        dive.recordCreation(hookData.TypeName || 'anonymous', instance, hookData.existentInstance);
        dive.wrapInstanceMethods(instance);
    });
    collection.registerHook('creationError', (hookData) => {
        dive.recordCreationError(hookData.TypeName || 'anonymous', hookData.inheritedInstance, hookData.existentInstance);
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0YWNoLWhvb2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2hvb2tzL2F0dGFjaC1ob29rcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSCxPQUFPLEVBQ04sV0FBVyxHQUdYLE1BQU0sZ0JBQWdCLENBQUM7QUFNeEIseUVBQXlFO0FBQ3pFLHNFQUFzRTtBQUN0RSwwRUFBMEU7QUFDMUUsTUFBTSxPQUFPLEdBQUcsQ0FBQyxLQUFjLEVBQWtCLEVBQUU7SUFDbEQsTUFBTSxNQUFNLEdBQUcsT0FBTyxLQUFLLEtBQUssVUFBVSxDQUFDO0lBQzNDLE9BQU8sTUFBTSxDQUFDO0FBQ2YsQ0FBQyxDQUFDO0FBRUYsTUFBTSxVQUFVLFdBQVcsQ0FBRSxVQUEyQixFQUFFLE9BQTRCO0lBQ3JGLE1BQU0sSUFBSSxHQUFZLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUMzQyxVQUFVLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFO1FBQ25ELE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQztRQUN6QyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1osSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBQ0QsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsQ0FBQztRQUMxQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN6QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUN0QyxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUUsQ0FBQyxDQUFFLENBQUM7Z0JBQ3RCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ2xELElBQUksQ0FBRSxDQUFDLENBQUUsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUNsRCxDQUFDO1lBQ0YsQ0FBQztRQUNGLENBQUM7SUFDRixDQUFDLENBQUMsQ0FBQztJQUVILFVBQVUsQ0FBQyxZQUFZLENBQUMsY0FBYyxFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUU7UUFDcEQsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGlCQUFpQixDQUFDO1FBQzVDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNmLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xDLEtBQUssTUFBTSxHQUFHLElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUNqQyxJQUFJLENBQUMscUJBQXFCLENBQUMsR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBQzNDLENBQUM7UUFDRixDQUFDO1FBQ0QsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsUUFBUSxJQUFJLFdBQVcsRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDM0YsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxDQUFDO0lBRUgsVUFBVSxDQUFDLFlBQVksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxRQUFRLEVBQUUsRUFBRTtRQUNyRCxJQUFJLENBQUMsbUJBQW1CLENBQ3ZCLFFBQVEsQ0FBQyxRQUFRLElBQUksV0FBVyxFQUNoQyxRQUFRLENBQUMsaUJBQWlCLEVBQzFCLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FDekIsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogYXR0YWNoSG9va3Mg4oCUIHRoZSBtbmVtb25pY2EgbGlmZWN5Y2xlIHdpcmluZyBmb3IgQG1uZW1vbmljYS9kaXZlLlxuICpcbiAqIFRoaXMgbGl2ZWQgaW5zaWRlIGRpdmUgaXRzZWxmIHVudGlsIGRpdmUgYmVjYW1lIGVuZ2luZS1vbmx5OiBkaXZlIGltcG9ydHNcbiAqIG5vdGhpbmcgYnV0IG5vZGU6Y3J5cHRvIGFuZCBleHBvc2VzIHByaW1pdGl2ZXMgKHdyYXAsIHJlY29yZENyZWF0aW9uLCDigKYpO1xuICogdGhlIGtub3dsZWRnZSBvZiBtbmVtb25pY2EncyBob29rIGNvbnRyYWN0IOKAlCBob29rIG5hbWVzLCBob29rc09wdHMgZmllbGRzLFxuICogYW5kIHdoYXQgYSBST09UIGNvbnN0cnVjdGlvbiBpcyDigJQgYmVsb25ncyBoZXJlIGF0IGFkYXB0ZXIgbGV2ZWwuXG4gKlxuICogcHJlQ3JlYXRpb24gIOKGkiBlbnRlciB0aGUgcGFyZW50IChleGlzdGVudEluc3RhbmNlKSBjb250ZXh0IEJFRk9SRSB0aGVcbiAqICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yIHJ1bnMsIGFuZCB3cmFwIGFueSBmdW5jdGlvbiBhcmd1bWVudHMgc29cbiAqICAgICAgICAgICAgICAgIGNhbGxiYWNrcyBoYW5kZWQgdG8gdGhlIGNvbnN0cnVjdG9yIGNhcnJ5IHRoYXQgY29udGV4dC5cbiAqIHBvc3RDcmVhdGlvbiDihpIgcmVjb3JkIHRoZSBpbnN0YW5jZSdzICdjcmVhdGUnIGVkZ2UgdmlhIHJlY29yZENyZWF0aW9uLFxuICogICAgICAgICAgICAgICAgdGhlbiB3cmFwIHRoZSBpbnN0YW5jZSdzIG1ldGhvZHMuXG4gKiBjcmVhdGlvbkVycm9y4oaSIHJlY29yZCBhIGZhaWxlZCAnY3JlYXRlJyBlZGdlIChzdGF0dXM6ICdlcnJvcicpIHVuZGVyIHRoZVxuICogICAgICAgICAgICAgICAgc3Vydml2aW5nIHBhcmVudCBhbmQgcGluIHRoZSBlcnJvciB0byBpdDogdGhlIGZhaWx1cmUgaXNcbiAqICAgICAgICAgICAgICAgIHJlY292ZXJhYmxlIG9mZiB0aGUgZXJyb3Igb2JqZWN0IGl0c2VsZi5cbiAqXG4gKiBBbGwgb2YgaXQgcnVucyBhZ2FpbnN0IE9ORSBkaXZlOiB0aGUgZGVmYXVsdCBkaXZlIHVubGVzcyB0aGUgY2FsbGVyXG4gKiBwYXNzZXMgdGhlaXIgb3duIChgbmV3IERpdmUoKWAgZnJvbSBAbW5lbW9uaWNhL2RpdmUpIHZpYSBvcHRpb25zLmRpdmUg4oCUXG4gKiB0aGUgY29sbGVjdGlvbiB0aGVuIHRyYWNlcyBpbnRvIHRoYXQgZGl2ZSBhbG9uZS5cbiAqL1xuaW1wb3J0IHtcblx0cmVzb2x2ZURpdmUsXG5cdHR5cGUgRGl2ZUFwaSxcblx0dHlwZSBEaXZlT3B0aW9uLFxufSBmcm9tICcuLi9kaXZlLWFwaS5qcyc7XG5pbXBvcnQgdHlwZSB7IEFueUZuIH0gZnJvbSAnQG1uZW1vbmljYS9kaXZlJztcbmltcG9ydCB0eXBlIHsgVHlwZXNDb2xsZWN0aW9uIH0gZnJvbSAnbW5lbW9uaWNhL21vZHVsZSc7XG5cbmV4cG9ydCB0eXBlIEF0dGFjaEhvb2tzT3B0aW9ucyA9IERpdmVPcHRpb247XG5cbi8vIGB0eXBlb2YgPT09ICdmdW5jdGlvbidgIG5hcnJvd3MgdG8gdGhlIGJhbm5lZCBiYXJlIEZ1bmN0aW9uIHR5cGU7IHRoaXNcbi8vIGd1YXJkIHJlLWdyb3VuZHMgdGhlIHZhbHVlIHRvIGRpdmUncyBBbnlGbiBpbnN0ZWFkIChuZXZlcltdIGFjY2VwdHNcbi8vIGV2ZXJ5IHBhcmFtZXRlciBsaXN0IOKAlCB0aGUgY2FsbGVyJ3Mgc2lnbmF0dXJlIGlzIHRoZSBjYWxsZXIncyBidXNpbmVzcylcbmNvbnN0IGlzQW55Rm4gPSAodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBBbnlGbiA9PiB7XG5cdGNvbnN0IHJlc3VsdCA9IHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcblx0cmV0dXJuIHJlc3VsdDtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdHRhY2hIb29rcyAoY29sbGVjdGlvbjogVHlwZXNDb2xsZWN0aW9uLCBvcHRpb25zPzogQXR0YWNoSG9va3NPcHRpb25zKTogdm9pZCB7XG5cdGNvbnN0IGRpdmU6IERpdmVBcGkgPSByZXNvbHZlRGl2ZShvcHRpb25zKTtcblx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3ByZUNyZWF0aW9uJywgKGhvb2tEYXRhKSA9PiB7XG5cdFx0Y29uc3QgcGFyZW50ID0gaG9va0RhdGEuZXhpc3RlbnRJbnN0YW5jZTtcblx0XHRpZiAocGFyZW50KSB7XG5cdFx0XHRkaXZlLmVudGVyQ29udGV4dChwYXJlbnQpO1xuXHRcdH1cblx0XHRjb25zdCB7IGFyZ3MgfSA9IGhvb2tEYXRhO1xuXHRcdGlmIChBcnJheS5pc0FycmF5KGFyZ3MpKSB7XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcblx0XHRcdFx0Y29uc3QgYXJnID0gYXJnc1sgaSBdO1xuXHRcdFx0XHRpZiAoaXNBbnlGbihhcmcpICYmICFkaXZlLmlzV3JhcHBlZEZ1bmN0aW9uKGFyZykpIHtcblx0XHRcdFx0XHRhcmdzWyBpIF0gPSBkaXZlLndyYXBDb25zdHJ1Y3RvckFyZyhhcmcsIHBhcmVudCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdH0pO1xuXG5cdGNvbGxlY3Rpb24ucmVnaXN0ZXJIb29rKCdwb3N0Q3JlYXRpb24nLCAoaG9va0RhdGEpID0+IHtcblx0XHRjb25zdCBpbnN0YW5jZSA9IGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlO1xuXHRcdGlmICghaW5zdGFuY2UpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKEFycmF5LmlzQXJyYXkoaG9va0RhdGEuYXJncykpIHtcblx0XHRcdGZvciAoY29uc3QgYXJnIG9mIGhvb2tEYXRhLmFyZ3MpIHtcblx0XHRcdFx0ZGl2ZS51cGdyYWRlQ29uc3RydWN0b3JBcmcoYXJnLCBpbnN0YW5jZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGRpdmUucmVjb3JkQ3JlYXRpb24oaG9va0RhdGEuVHlwZU5hbWUgfHwgJ2Fub255bW91cycsIGluc3RhbmNlLCBob29rRGF0YS5leGlzdGVudEluc3RhbmNlKTtcblx0XHRkaXZlLndyYXBJbnN0YW5jZU1ldGhvZHMoaW5zdGFuY2UpO1xuXHR9KTtcblxuXHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygnY3JlYXRpb25FcnJvcicsIChob29rRGF0YSkgPT4ge1xuXHRcdGRpdmUucmVjb3JkQ3JlYXRpb25FcnJvcihcblx0XHRcdGhvb2tEYXRhLlR5cGVOYW1lIHx8ICdhbm9ueW1vdXMnLFxuXHRcdFx0aG9va0RhdGEuaW5oZXJpdGVkSW5zdGFuY2UsXG5cdFx0XHRob29rRGF0YS5leGlzdGVudEluc3RhbmNlXG5cdFx0KTtcblx0fSk7XG59XG4iXX0=