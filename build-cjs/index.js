"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorContext = exports.formatFlow = exports.isMnemonicaInstance = exports.recordErrorAnalysis = exports.analyseError = exports.captureError = exports.getPreRoot = exports.feedValidatedPreRoot = exports.feedPreRoot = exports.runInEntryScope = exports.AsyncFlowProvider = exports.DiveOtelProvider = exports.MnemonicaOtelProvider = exports.attachHooks = void 0;
var attach_hooks_js_1 = require("./hooks/attach-hooks.js");
Object.defineProperty(exports, "attachHooks", { enumerable: true, get: function () { return attach_hooks_js_1.attachHooks; } });
var mnemonica_otel_provider_js_1 = require("./providers/mnemonica-otel.provider.js");
Object.defineProperty(exports, "MnemonicaOtelProvider", { enumerable: true, get: function () { return mnemonica_otel_provider_js_1.MnemonicaOtelProvider; } });
var dive_otel_provider_js_1 = require("./providers/dive-otel.provider.js");
Object.defineProperty(exports, "DiveOtelProvider", { enumerable: true, get: function () { return dive_otel_provider_js_1.DiveOtelProvider; } });
var async_flow_provider_js_1 = require("./providers/async-flow.provider.js");
Object.defineProperty(exports, "AsyncFlowProvider", { enumerable: true, get: function () { return async_flow_provider_js_1.AsyncFlowProvider; } });
var entry_scope_js_1 = require("./entry-scope.js");
Object.defineProperty(exports, "runInEntryScope", { enumerable: true, get: function () { return entry_scope_js_1.runInEntryScope; } });
var pre_root_js_1 = require("./thunderstruck/pre-root.js");
Object.defineProperty(exports, "feedPreRoot", { enumerable: true, get: function () { return pre_root_js_1.feedPreRoot; } });
Object.defineProperty(exports, "feedValidatedPreRoot", { enumerable: true, get: function () { return pre_root_js_1.feedValidatedPreRoot; } });
Object.defineProperty(exports, "getPreRoot", { enumerable: true, get: function () { return pre_root_js_1.getPreRoot; } });
var error_analysis_js_1 = require("./error-analysis.js");
Object.defineProperty(exports, "captureError", { enumerable: true, get: function () { return error_analysis_js_1.captureError; } });
Object.defineProperty(exports, "analyseError", { enumerable: true, get: function () { return error_analysis_js_1.analyseError; } });
Object.defineProperty(exports, "recordErrorAnalysis", { enumerable: true, get: function () { return error_analysis_js_1.recordErrorAnalysis; } });
var is_mnemonica_instance_js_1 = require("./utils/is-mnemonica-instance.js");
Object.defineProperty(exports, "isMnemonicaInstance", { enumerable: true, get: function () { return is_mnemonica_instance_js_1.isMnemonicaInstance; } });
var dive_flow_js_1 = require("./utils/dive-flow.js");
Object.defineProperty(exports, "formatFlow", { enumerable: true, get: function () { return dive_flow_js_1.formatFlow; } });
Object.defineProperty(exports, "errorContext", { enumerable: true, get: function () { return dive_flow_js_1.errorContext; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRzs7O0FBRUgsMkRBQXNEO0FBQTdDLDhHQUFBLFdBQVcsT0FBQTtBQUNwQixxRkFBK0U7QUFBdEUsbUlBQUEscUJBQXFCLE9BQUE7QUFDOUIsMkVBQXFFO0FBQTVELHlIQUFBLGdCQUFnQixPQUFBO0FBQ3pCLDZFQUEwRztBQUFqRywySEFBQSxpQkFBaUIsT0FBQTtBQUMxQixtREFBOEY7QUFBckYsaUhBQUEsZUFBZSxPQUFBO0FBQ3hCLDJEQU9xQztBQU5wQywwR0FBQSxXQUFXLE9BQUE7QUFDWCxtSEFBQSxvQkFBb0IsT0FBQTtBQUNwQix5R0FBQSxVQUFVLE9BQUE7QUFLWCx5REFVNkI7QUFUNUIsaUhBQUEsWUFBWSxPQUFBO0FBQ1osaUhBQUEsWUFBWSxPQUFBO0FBQ1osd0hBQUEsbUJBQW1CLE9BQUE7QUFRcEIsNkVBQXVFO0FBQTlELCtIQUFBLG1CQUFtQixPQUFBO0FBQzVCLHFEQUF3RjtBQUEvRSwwR0FBQSxVQUFVLE9BQUE7QUFBRSw0R0FBQSxZQUFZLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBtbmVtb25pY2Evb3RlbCDigJQgdGhlIGZyYW1ld29yay1mcmVlIE5vZGUuanMgY29yZSBvZiB0aGUgbW5lbW9uaWNhXG4gKiBvYnNlcnZhYmlsaXR5IHN0YWNrLlxuICpcbiAqIEV2ZXJ5dGhpbmcgaGVyZSB3b3JrcyBpbiBBTlkgTm9kZS5qcyBydW50aW1lIChFeHByZXNzLCBGYXN0aWZ5LCByYXdcbiAqIGh0dHAsIHF1ZXVlIGNvbnN1bWVycywgQ0xJKTsgZnJhbWV3b3JrIHdpcmluZyBsaXZlcyBpbiBkZWRpY2F0ZWRcbiAqIGFkYXB0ZXIgcGFja2FnZXMgYnVpbHQgb24gdGhlc2UgcHJpbWl0aXZlcy5cbiAqXG4gKiBQcm92aWRlczpcbiAqICAgLSBhdHRhY2hIb29rcygpIOKAlCBtbmVtb25pY2EgbGlmZWN5Y2xlIOKGkiBkaXZlIGVkZ2Ugd2lyaW5nXG4gKiAgIC0gTW5lbW9uaWNhT3RlbFByb3ZpZGVyIOKAlCBPVGVsIHNwYW5zIGZvciBjb25zdHJ1Y3Rpb25zXG4gKiAgIC0gRGl2ZU90ZWxQcm92aWRlciDigJQgT1RlbCBzcGFucyBmb3IgZXZlcnkgZGl2ZS13cmFwcGVkIGNhbGxcbiAqICAgLSBBc3luY0Zsb3dQcm92aWRlciDigJQgQUxTIGJhY2tib25lIGF0dHJpYnV0aW5nIHVud3JhcHBlZCBhc3luYyBob3BzXG4gKiAgIC0gcnVuSW5FbnRyeVNjb3BlKCkg4oCUIG9uZSByb290IHNwYW4gcGVyIHVuaXQgb2Ygd29yayAocmVxdWVzdCwgbWVzc2FnZSxcbiAqICAgICBjb21tYW5kKSArIHRoZSB0cmlwbGUgc2NvcGUgZW50cnkgKHByb3ZpZGVyIEFMUywgT1RFTCBnbG9iYWwgY29udGV4dCxcbiAqICAgICBhc3luYy1mbG93IHJvb3QgZnJhbWUpOyBmcmFtZXdvcmsgd2lyaW5nIGlzIFJFQURNRSByZWNpcGVzIG9uIHRvcFxuICogICAtIGZlZWRQcmVSb290KCkvZmVlZFZhbGlkYXRlZFByZVJvb3QoKS9nZXRQcmVSb290KCkg4oCUIHRodW5kZXJzdHJ1Y2tcbiAqICAgICBwcmUtcm9vdCBmb3JlbnNpY3Mgc3RvcmUgKGlkZW50aXR5LWNvcnJlbGF0ZWQsIHJlcXVlc3QtbGlmZXRpbWUpXG4gKiAgIC0gY2FwdHVyZUVycm9yKCkvYW5hbHlzZUVycm9yKCkvcmVjb3JkRXJyb3JBbmFseXNpcygpIOKAlCB0aGUgZXJyb3JcbiAqICAgICBhbmFseXNpczogZXJyb3Ig4oaSIGl0cyBkaXZlIGVkZ2Ug4oaSIGl0cyBpbnN0YW5jZXMgKGRhdGEgcmV0dXJuZWQsIG5ldmVyXG4gKiAgICAgcHJpbnRlZCk7IHRoZSBsaW5lYWdlIGdyYXBoIHJpZGVzIGEgc3BhbiBldmVudCB0aGUgY2FsbGVyIHBhc3Nlc1xuICogICAtIGlzTW5lbW9uaWNhSW5zdGFuY2UoKSDigJQgcmVhbG0tc2FmZSB0eXBlIGd1YXJkXG4gKiAgIC0gZm9ybWF0RmxvdygpL2Vycm9yQ29udGV4dCgpIOKAlCByZWFkLXNpZGUgaGVscGVycyBvdmVyIGRpdmUncyB0cmFjZVxuICovXG5cbmV4cG9ydCB7IGF0dGFjaEhvb2tzIH0gZnJvbSAnLi9ob29rcy9hdHRhY2gtaG9va3MuanMnO1xuZXhwb3J0IHsgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMvbW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMnO1xuZXhwb3J0IHsgRGl2ZU90ZWxQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXJzL2RpdmUtb3RlbC5wcm92aWRlci5qcyc7XG5leHBvcnQgeyBBc3luY0Zsb3dQcm92aWRlciwgdHlwZSBGbG93RnJhbWUsIHR5cGUgQ3Jhc2hDb250ZXh0IH0gZnJvbSAnLi9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci5qcyc7XG5leHBvcnQgeyBydW5JbkVudHJ5U2NvcGUsIHR5cGUgRW50cnlEZWZpbml0aW9uLCB0eXBlIEVudHJ5U2NvcGVEZXBzIH0gZnJvbSAnLi9lbnRyeS1zY29wZS5qcyc7XG5leHBvcnQge1xuXHRmZWVkUHJlUm9vdCxcblx0ZmVlZFZhbGlkYXRlZFByZVJvb3QsXG5cdGdldFByZVJvb3QsXG5cdHR5cGUgUmF3UHJlUm9vdFBheWxvYWQsXG5cdHR5cGUgUHJlUm9vdFJlY29yZCxcblx0dHlwZSBQcmVSb290RGF0YSxcbn0gZnJvbSAnLi90aHVuZGVyc3RydWNrL3ByZS1yb290LmpzJztcbmV4cG9ydCB7XG5cdGNhcHR1cmVFcnJvcixcblx0YW5hbHlzZUVycm9yLFxuXHRyZWNvcmRFcnJvckFuYWx5c2lzLFxuXHR0eXBlIEVycm9yU291cmNlLFxuXHR0eXBlIEVycm9yQW5hbHlzaXMsXG5cdHR5cGUgRXJyb3JDYXB0dXJlLFxuXHR0eXBlIEVycm9yQW5hbHlzaXNEZXBzLFxuXHR0eXBlIEFuYWx5c2lzQnVkZ2V0LFxuXHR0eXBlIEFuYWx5c2VkRWRnZSxcbn0gZnJvbSAnLi9lcnJvci1hbmFseXNpcy5qcyc7XG5leHBvcnQgeyBpc01uZW1vbmljYUluc3RhbmNlIH0gZnJvbSAnLi91dGlscy9pcy1tbmVtb25pY2EtaW5zdGFuY2UuanMnO1xuZXhwb3J0IHsgZm9ybWF0RmxvdywgZXJyb3JDb250ZXh0LCB0eXBlIEZvcm1hdHRlZEZsb3dFZGdlIH0gZnJvbSAnLi91dGlscy9kaXZlLWZsb3cuanMnO1xuIl19