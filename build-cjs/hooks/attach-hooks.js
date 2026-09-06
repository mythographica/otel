"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachHooks = attachHooks;
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
 */
const dive_1 = require("@mnemonica/dive");
function attachHooks(collection) {
    collection.registerHook('preCreation', (hookData) => {
        const parent = hookData.existentInstance;
        if (parent) {
            (0, dive_1.enterContext)(parent);
        }
        const args = hookData.args;
        if (Array.isArray(args)) {
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                if (typeof arg === 'function' && !(0, dive_1.isWrappedFunction)(arg)) {
                    args[i] = (0, dive_1.wrapConstructorArg)(arg, parent);
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
                (0, dive_1.upgradeConstructorArg)(arg, instance);
            }
        }
        (0, dive_1.recordCreation)(hookData.TypeName || 'anonymous', instance, hookData.existentInstance);
        (0, dive_1.wrapInstanceMethods)(instance);
    });
    collection.registerHook('creationError', (hookData) => {
        (0, dive_1.recordCreationError)(hookData.TypeName || 'anonymous', hookData.inheritedInstance, hookData.existentInstance);
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0YWNoLWhvb2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2hvb2tzL2F0dGFjaC1ob29rcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQTRCQSxrQ0FzQ0M7QUFsRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7QUFDSCwwQ0FReUI7QUFHekIsU0FBZ0IsV0FBVyxDQUFFLFVBQTJCO0lBQ3ZELFVBQVUsQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUU7UUFDbkQsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLGdCQUFnQixDQUFDO1FBQ3pDLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWixJQUFBLG1CQUFZLEVBQUMsTUFBTSxDQUFDLENBQUM7UUFDdEIsQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDM0IsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDekIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwQixJQUFJLE9BQU8sR0FBRyxLQUFLLFVBQVUsSUFBSSxDQUFDLElBQUEsd0JBQWlCLEVBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDMUQsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUEseUJBQWtCLEVBQUMsR0FBbUMsRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDM0UsQ0FBQztZQUNGLENBQUM7UUFDRixDQUFDO0lBQ0YsQ0FBQyxDQUFDLENBQUM7SUFFSCxVQUFVLENBQUMsWUFBWSxDQUFDLGNBQWMsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFO1FBQ3BELE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQztRQUM1QyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZixPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNsQyxLQUFLLE1BQU0sR0FBRyxJQUFJLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDakMsSUFBQSw0QkFBcUIsRUFBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDdEMsQ0FBQztRQUNGLENBQUM7UUFDRCxJQUFBLHFCQUFjLEVBQUMsUUFBUSxDQUFDLFFBQVEsSUFBSSxXQUFXLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3RGLElBQUEsMEJBQW1CLEVBQUMsUUFBUSxDQUFDLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxVQUFVLENBQUMsWUFBWSxDQUFDLGVBQWUsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFO1FBQ3JELElBQUEsMEJBQW1CLEVBQ2xCLFFBQVEsQ0FBQyxRQUFRLElBQUksV0FBVyxFQUNoQyxRQUFRLENBQUMsaUJBQWlCLEVBQzFCLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FDekIsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogYXR0YWNoSG9va3Mg4oCUIHRoZSBtbmVtb25pY2EgbGlmZWN5Y2xlIHdpcmluZyBmb3IgQG1uZW1vbmljYS9kaXZlLlxuICpcbiAqIFRoaXMgbGl2ZWQgaW5zaWRlIGRpdmUgaXRzZWxmIHVudGlsIGRpdmUgYmVjYW1lIGVuZ2luZS1vbmx5OiBkaXZlIGltcG9ydHNcbiAqIG5vdGhpbmcgYnV0IG5vZGU6Y3J5cHRvIGFuZCBleHBvc2VzIHByaW1pdGl2ZXMgKHdyYXAsIHJlY29yZENyZWF0aW9uLCDigKYpO1xuICogdGhlIGtub3dsZWRnZSBvZiBtbmVtb25pY2EncyBob29rIGNvbnRyYWN0IOKAlCBob29rIG5hbWVzLCBob29rc09wdHMgZmllbGRzLFxuICogYW5kIHdoYXQgYSBST09UIGNvbnN0cnVjdGlvbiBpcyDigJQgYmVsb25ncyBoZXJlIGF0IGFkYXB0ZXIgbGV2ZWwuXG4gKlxuICogcHJlQ3JlYXRpb24gIOKGkiBlbnRlciB0aGUgcGFyZW50IChleGlzdGVudEluc3RhbmNlKSBjb250ZXh0IEJFRk9SRSB0aGVcbiAqICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yIHJ1bnMsIGFuZCB3cmFwIGFueSBmdW5jdGlvbiBhcmd1bWVudHMgc29cbiAqICAgICAgICAgICAgICAgIGNhbGxiYWNrcyBoYW5kZWQgdG8gdGhlIGNvbnN0cnVjdG9yIGNhcnJ5IHRoYXQgY29udGV4dC5cbiAqIHBvc3RDcmVhdGlvbiDihpIgcmVjb3JkIHRoZSBpbnN0YW5jZSdzICdjcmVhdGUnIGVkZ2UgdmlhIHJlY29yZENyZWF0aW9uLFxuICogICAgICAgICAgICAgICAgdGhlbiB3cmFwIHRoZSBpbnN0YW5jZSdzIG1ldGhvZHMuXG4gKiBjcmVhdGlvbkVycm9y4oaSIHJlY29yZCBhIGZhaWxlZCAnY3JlYXRlJyBlZGdlIChzdGF0dXM6ICdlcnJvcicpIHVuZGVyIHRoZVxuICogICAgICAgICAgICAgICAgc3Vydml2aW5nIHBhcmVudCBhbmQgcGluIHRoZSBlcnJvciB0byBpdDogdGhlIGZhaWx1cmUgaXNcbiAqICAgICAgICAgICAgICAgIHJlY292ZXJhYmxlIG9mZiB0aGUgZXJyb3Igb2JqZWN0IGl0c2VsZi5cbiAqL1xuaW1wb3J0IHtcblx0ZW50ZXJDb250ZXh0LFxuXHR3cmFwQ29uc3RydWN0b3JBcmcsXG5cdHVwZ3JhZGVDb25zdHJ1Y3RvckFyZyxcblx0d3JhcEluc3RhbmNlTWV0aG9kcyxcblx0cmVjb3JkQ3JlYXRpb24sXG5cdHJlY29yZENyZWF0aW9uRXJyb3IsXG5cdGlzV3JhcHBlZEZ1bmN0aW9uLFxufSBmcm9tICdAbW5lbW9uaWNhL2RpdmUnO1xuaW1wb3J0IHR5cGUgeyBUeXBlc0NvbGxlY3Rpb24gfSBmcm9tICdtbmVtb25pY2EvbW9kdWxlJztcblxuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaEhvb2tzIChjb2xsZWN0aW9uOiBUeXBlc0NvbGxlY3Rpb24pOiB2b2lkIHtcblx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3ByZUNyZWF0aW9uJywgKGhvb2tEYXRhKSA9PiB7XG5cdFx0Y29uc3QgcGFyZW50ID0gaG9va0RhdGEuZXhpc3RlbnRJbnN0YW5jZTtcblx0XHRpZiAocGFyZW50KSB7XG5cdFx0XHRlbnRlckNvbnRleHQocGFyZW50KTtcblx0XHR9XG5cdFx0Y29uc3QgYXJncyA9IGhvb2tEYXRhLmFyZ3M7XG5cdFx0aWYgKEFycmF5LmlzQXJyYXkoYXJncykpIHtcblx0XHRcdGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuXHRcdFx0XHRjb25zdCBhcmcgPSBhcmdzW2ldO1xuXHRcdFx0XHRpZiAodHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJyAmJiAhaXNXcmFwcGVkRnVuY3Rpb24oYXJnKSkge1xuXHRcdFx0XHRcdGFyZ3NbaV0gPSB3cmFwQ29uc3RydWN0b3JBcmcoYXJnIGFzICguLi5hOiB1bmtub3duW10pID0+IHVua25vd24sIHBhcmVudCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdH0pO1xuXG5cdGNvbGxlY3Rpb24ucmVnaXN0ZXJIb29rKCdwb3N0Q3JlYXRpb24nLCAoaG9va0RhdGEpID0+IHtcblx0XHRjb25zdCBpbnN0YW5jZSA9IGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlO1xuXHRcdGlmICghaW5zdGFuY2UpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKEFycmF5LmlzQXJyYXkoaG9va0RhdGEuYXJncykpIHtcblx0XHRcdGZvciAoY29uc3QgYXJnIG9mIGhvb2tEYXRhLmFyZ3MpIHtcblx0XHRcdFx0dXBncmFkZUNvbnN0cnVjdG9yQXJnKGFyZywgaW5zdGFuY2UpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZWNvcmRDcmVhdGlvbihob29rRGF0YS5UeXBlTmFtZSB8fCAnYW5vbnltb3VzJywgaW5zdGFuY2UsIGhvb2tEYXRhLmV4aXN0ZW50SW5zdGFuY2UpO1xuXHRcdHdyYXBJbnN0YW5jZU1ldGhvZHMoaW5zdGFuY2UpO1xuXHR9KTtcblxuXHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygnY3JlYXRpb25FcnJvcicsIChob29rRGF0YSkgPT4ge1xuXHRcdHJlY29yZENyZWF0aW9uRXJyb3IoXG5cdFx0XHRob29rRGF0YS5UeXBlTmFtZSB8fCAnYW5vbnltb3VzJyxcblx0XHRcdGhvb2tEYXRhLmluaGVyaXRlZEluc3RhbmNlLFxuXHRcdFx0aG9va0RhdGEuZXhpc3RlbnRJbnN0YW5jZVxuXHRcdCk7XG5cdH0pO1xufVxuIl19