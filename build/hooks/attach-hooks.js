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
import { enterContext, wrapConstructorArg, upgradeConstructorArg, wrapInstanceMethods, recordCreation, recordCreationError, isWrappedFunction, } from '@mnemonica/dive';
export function attachHooks(collection) {
    collection.registerHook('preCreation', (hookData) => {
        const parent = hookData.existentInstance;
        if (parent) {
            enterContext(parent);
        }
        const args = hookData.args;
        if (Array.isArray(args)) {
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                if (typeof arg === 'function' && !isWrappedFunction(arg)) {
                    args[i] = wrapConstructorArg(arg, parent);
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
                upgradeConstructorArg(arg, instance);
            }
        }
        recordCreation(hookData.TypeName || 'anonymous', instance, hookData.existentInstance);
        wrapInstanceMethods(instance);
    });
    collection.registerHook('creationError', (hookData) => {
        recordCreationError(hookData.TypeName || 'anonymous', hookData.inheritedInstance, hookData.existentInstance);
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0YWNoLWhvb2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2hvb2tzL2F0dGFjaC1ob29rcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE9BQU8sRUFDTixZQUFZLEVBQ1osa0JBQWtCLEVBQ2xCLHFCQUFxQixFQUNyQixtQkFBbUIsRUFDbkIsY0FBYyxFQUNkLG1CQUFtQixFQUNuQixpQkFBaUIsR0FDakIsTUFBTSxpQkFBaUIsQ0FBQztBQUd6QixNQUFNLFVBQVUsV0FBVyxDQUFFLFVBQTJCO0lBQ3ZELFVBQVUsQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUU7UUFDbkQsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLGdCQUFnQixDQUFDO1FBQ3pDLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWixZQUFZLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDdEIsQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDM0IsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDekIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwQixJQUFJLE9BQU8sR0FBRyxLQUFLLFVBQVUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzFELElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxrQkFBa0IsQ0FBQyxHQUFtQyxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUMzRSxDQUFDO1lBQ0YsQ0FBQztRQUNGLENBQUM7SUFDRixDQUFDLENBQUMsQ0FBQztJQUVILFVBQVUsQ0FBQyxZQUFZLENBQUMsY0FBYyxFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUU7UUFDcEQsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGlCQUFpQixDQUFDO1FBQzVDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNmLE9BQU87UUFDUixDQUFDO1FBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xDLEtBQUssTUFBTSxHQUFHLElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUNqQyxxQkFBcUIsQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDdEMsQ0FBQztRQUNGLENBQUM7UUFDRCxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVEsSUFBSSxXQUFXLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3RGLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQy9CLENBQUMsQ0FBQyxDQUFDO0lBRUgsVUFBVSxDQUFDLFlBQVksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxRQUFRLEVBQUUsRUFBRTtRQUNyRCxtQkFBbUIsQ0FDbEIsUUFBUSxDQUFDLFFBQVEsSUFBSSxXQUFXLEVBQ2hDLFFBQVEsQ0FBQyxpQkFBaUIsRUFDMUIsUUFBUSxDQUFDLGdCQUFnQixDQUN6QixDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBhdHRhY2hIb29rcyDigJQgdGhlIG1uZW1vbmljYSBsaWZlY3ljbGUgd2lyaW5nIGZvciBAbW5lbW9uaWNhL2RpdmUuXG4gKlxuICogVGhpcyBsaXZlZCBpbnNpZGUgZGl2ZSBpdHNlbGYgdW50aWwgZGl2ZSBiZWNhbWUgZW5naW5lLW9ubHk6IGRpdmUgaW1wb3J0c1xuICogbm90aGluZyBidXQgbm9kZTpjcnlwdG8gYW5kIGV4cG9zZXMgcHJpbWl0aXZlcyAod3JhcCwgcmVjb3JkQ3JlYXRpb24sIOKApik7XG4gKiB0aGUga25vd2xlZGdlIG9mIG1uZW1vbmljYSdzIGhvb2sgY29udHJhY3Qg4oCUIGhvb2sgbmFtZXMsIGhvb2tzT3B0cyBmaWVsZHMsXG4gKiBhbmQgd2hhdCBhIFJPT1QgY29uc3RydWN0aW9uIGlzIOKAlCBiZWxvbmdzIGhlcmUgYXQgYWRhcHRlciBsZXZlbC5cbiAqXG4gKiBwcmVDcmVhdGlvbiAg4oaSIGVudGVyIHRoZSBwYXJlbnQgKGV4aXN0ZW50SW5zdGFuY2UpIGNvbnRleHQgQkVGT1JFIHRoZVxuICogICAgICAgICAgICAgICAgY29uc3RydWN0b3IgcnVucywgYW5kIHdyYXAgYW55IGZ1bmN0aW9uIGFyZ3VtZW50cyBzb1xuICogICAgICAgICAgICAgICAgY2FsbGJhY2tzIGhhbmRlZCB0byB0aGUgY29uc3RydWN0b3IgY2FycnkgdGhhdCBjb250ZXh0LlxuICogcG9zdENyZWF0aW9uIOKGkiByZWNvcmQgdGhlIGluc3RhbmNlJ3MgJ2NyZWF0ZScgZWRnZSB2aWEgcmVjb3JkQ3JlYXRpb24sXG4gKiAgICAgICAgICAgICAgICB0aGVuIHdyYXAgdGhlIGluc3RhbmNlJ3MgbWV0aG9kcy5cbiAqIGNyZWF0aW9uRXJyb3LihpIgcmVjb3JkIGEgZmFpbGVkICdjcmVhdGUnIGVkZ2UgKHN0YXR1czogJ2Vycm9yJykgdW5kZXIgdGhlXG4gKiAgICAgICAgICAgICAgICBzdXJ2aXZpbmcgcGFyZW50IGFuZCBwaW4gdGhlIGVycm9yIHRvIGl0OiB0aGUgZmFpbHVyZSBpc1xuICogICAgICAgICAgICAgICAgcmVjb3ZlcmFibGUgb2ZmIHRoZSBlcnJvciBvYmplY3QgaXRzZWxmLlxuICovXG5pbXBvcnQge1xuXHRlbnRlckNvbnRleHQsXG5cdHdyYXBDb25zdHJ1Y3RvckFyZyxcblx0dXBncmFkZUNvbnN0cnVjdG9yQXJnLFxuXHR3cmFwSW5zdGFuY2VNZXRob2RzLFxuXHRyZWNvcmRDcmVhdGlvbixcblx0cmVjb3JkQ3JlYXRpb25FcnJvcixcblx0aXNXcmFwcGVkRnVuY3Rpb24sXG59IGZyb20gJ0BtbmVtb25pY2EvZGl2ZSc7XG5pbXBvcnQgdHlwZSB7IFR5cGVzQ29sbGVjdGlvbiB9IGZyb20gJ21uZW1vbmljYS9tb2R1bGUnO1xuXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNoSG9va3MgKGNvbGxlY3Rpb246IFR5cGVzQ29sbGVjdGlvbik6IHZvaWQge1xuXHRjb2xsZWN0aW9uLnJlZ2lzdGVySG9vaygncHJlQ3JlYXRpb24nLCAoaG9va0RhdGEpID0+IHtcblx0XHRjb25zdCBwYXJlbnQgPSBob29rRGF0YS5leGlzdGVudEluc3RhbmNlO1xuXHRcdGlmIChwYXJlbnQpIHtcblx0XHRcdGVudGVyQ29udGV4dChwYXJlbnQpO1xuXHRcdH1cblx0XHRjb25zdCBhcmdzID0gaG9va0RhdGEuYXJncztcblx0XHRpZiAoQXJyYXkuaXNBcnJheShhcmdzKSkge1xuXHRcdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdGNvbnN0IGFyZyA9IGFyZ3NbaV07XG5cdFx0XHRcdGlmICh0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nICYmICFpc1dyYXBwZWRGdW5jdGlvbihhcmcpKSB7XG5cdFx0XHRcdFx0YXJnc1tpXSA9IHdyYXBDb25zdHJ1Y3RvckFyZyhhcmcgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93biwgcGFyZW50KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fSk7XG5cblx0Y29sbGVjdGlvbi5yZWdpc3Rlckhvb2soJ3Bvc3RDcmVhdGlvbicsIChob29rRGF0YSkgPT4ge1xuXHRcdGNvbnN0IGluc3RhbmNlID0gaG9va0RhdGEuaW5oZXJpdGVkSW5zdGFuY2U7XG5cdFx0aWYgKCFpbnN0YW5jZSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAoQXJyYXkuaXNBcnJheShob29rRGF0YS5hcmdzKSkge1xuXHRcdFx0Zm9yIChjb25zdCBhcmcgb2YgaG9va0RhdGEuYXJncykge1xuXHRcdFx0XHR1cGdyYWRlQ29uc3RydWN0b3JBcmcoYXJnLCBpbnN0YW5jZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJlY29yZENyZWF0aW9uKGhvb2tEYXRhLlR5cGVOYW1lIHx8ICdhbm9ueW1vdXMnLCBpbnN0YW5jZSwgaG9va0RhdGEuZXhpc3RlbnRJbnN0YW5jZSk7XG5cdFx0d3JhcEluc3RhbmNlTWV0aG9kcyhpbnN0YW5jZSk7XG5cdH0pO1xuXG5cdGNvbGxlY3Rpb24ucmVnaXN0ZXJIb29rKCdjcmVhdGlvbkVycm9yJywgKGhvb2tEYXRhKSA9PiB7XG5cdFx0cmVjb3JkQ3JlYXRpb25FcnJvcihcblx0XHRcdGhvb2tEYXRhLlR5cGVOYW1lIHx8ICdhbm9ueW1vdXMnLFxuXHRcdFx0aG9va0RhdGEuaW5oZXJpdGVkSW5zdGFuY2UsXG5cdFx0XHRob29rRGF0YS5leGlzdGVudEluc3RhbmNlXG5cdFx0KTtcblx0fSk7XG59XG4iXX0=