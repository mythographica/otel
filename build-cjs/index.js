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
 *   - feedPreRootFromRequest() — boundary helper over any HTTP request
 *   - buildUnblindReport()/recordUnblindTelemetry() — the Unblinder core
 *   - isMnemonicaInstance() — realm-safe type guard
 *   - formatFlow()/errorContext() — read-side helpers over dive's trace
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorContext = exports.formatFlow = exports.isMnemonicaInstance = exports.stringifySafe = exports.erroredArgsSafe = exports.extractSafe = exports.recordUnblindTelemetry = exports.buildUnblindReport = exports.getPreRoot = exports.feedValidatedPreRoot = exports.feedPreRoot = exports.runInEntryScope = exports.AsyncFlowProvider = exports.DiveOtelProvider = exports.MnemonicaOtelProvider = exports.attachHooks = void 0;
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
var unblind_js_1 = require("./unblind.js");
Object.defineProperty(exports, "buildUnblindReport", { enumerable: true, get: function () { return unblind_js_1.buildUnblindReport; } });
Object.defineProperty(exports, "recordUnblindTelemetry", { enumerable: true, get: function () { return unblind_js_1.recordUnblindTelemetry; } });
Object.defineProperty(exports, "extractSafe", { enumerable: true, get: function () { return unblind_js_1.extractSafe; } });
Object.defineProperty(exports, "erroredArgsSafe", { enumerable: true, get: function () { return unblind_js_1.erroredArgsSafe; } });
Object.defineProperty(exports, "stringifySafe", { enumerable: true, get: function () { return unblind_js_1.stringifySafe; } });
var is_mnemonica_instance_js_1 = require("./utils/is-mnemonica-instance.js");
Object.defineProperty(exports, "isMnemonicaInstance", { enumerable: true, get: function () { return is_mnemonica_instance_js_1.isMnemonicaInstance; } });
var dive_flow_js_1 = require("./utils/dive-flow.js");
Object.defineProperty(exports, "formatFlow", { enumerable: true, get: function () { return dive_flow_js_1.formatFlow; } });
Object.defineProperty(exports, "errorContext", { enumerable: true, get: function () { return dive_flow_js_1.errorContext; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0JHOzs7QUFFSCwyREFBc0Q7QUFBN0MsOEdBQUEsV0FBVyxPQUFBO0FBQ3BCLHFGQUErRTtBQUF0RSxtSUFBQSxxQkFBcUIsT0FBQTtBQUM5QiwyRUFBcUU7QUFBNUQseUhBQUEsZ0JBQWdCLE9BQUE7QUFDekIsNkVBQTBHO0FBQWpHLDJIQUFBLGlCQUFpQixPQUFBO0FBQzFCLG1EQUE4RjtBQUFyRixpSEFBQSxlQUFlLE9BQUE7QUFDeEIsMkRBT3FDO0FBTnBDLDBHQUFBLFdBQVcsT0FBQTtBQUNYLG1IQUFBLG9CQUFvQixPQUFBO0FBQ3BCLHlHQUFBLFVBQVUsT0FBQTtBQUtYLDJDQU9zQjtBQU5yQixnSEFBQSxrQkFBa0IsT0FBQTtBQUNsQixvSEFBQSxzQkFBc0IsT0FBQTtBQUN0Qix5R0FBQSxXQUFXLE9BQUE7QUFDWCw2R0FBQSxlQUFlLE9BQUE7QUFDZiwyR0FBQSxhQUFhLE9BQUE7QUFHZCw2RUFBdUU7QUFBOUQsK0hBQUEsbUJBQW1CLE9BQUE7QUFDNUIscURBQXdGO0FBQS9FLDBHQUFBLFVBQVUsT0FBQTtBQUFFLDRHQUFBLFlBQVksT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQG1uZW1vbmljYS9vdGVsIOKAlCB0aGUgZnJhbWV3b3JrLWZyZWUgTm9kZS5qcyBjb3JlIG9mIHRoZSBtbmVtb25pY2FcbiAqIG9ic2VydmFiaWxpdHkgc3RhY2suXG4gKlxuICogRXZlcnl0aGluZyBoZXJlIHdvcmtzIGluIEFOWSBOb2RlLmpzIHJ1bnRpbWUgKEV4cHJlc3MsIEZhc3RpZnksIHJhd1xuICogaHR0cCwgcXVldWUgY29uc3VtZXJzLCBDTEkpOyBmcmFtZXdvcmsgd2lyaW5nIGxpdmVzIGluIGRlZGljYXRlZFxuICogYWRhcHRlciBwYWNrYWdlcyBidWlsdCBvbiB0aGVzZSBwcmltaXRpdmVzLlxuICpcbiAqIFByb3ZpZGVzOlxuICogICAtIGF0dGFjaEhvb2tzKCkg4oCUIG1uZW1vbmljYSBsaWZlY3ljbGUg4oaSIGRpdmUgZWRnZSB3aXJpbmdcbiAqICAgLSBNbmVtb25pY2FPdGVsUHJvdmlkZXIg4oCUIE9UZWwgc3BhbnMgZm9yIGNvbnN0cnVjdGlvbnNcbiAqICAgLSBEaXZlT3RlbFByb3ZpZGVyIOKAlCBPVGVsIHNwYW5zIGZvciBldmVyeSBkaXZlLXdyYXBwZWQgY2FsbFxuICogICAtIEFzeW5jRmxvd1Byb3ZpZGVyIOKAlCBBTFMgYmFja2JvbmUgYXR0cmlidXRpbmcgdW53cmFwcGVkIGFzeW5jIGhvcHNcbiAqICAgLSBydW5JbkVudHJ5U2NvcGUoKSDigJQgb25lIHJvb3Qgc3BhbiBwZXIgdW5pdCBvZiB3b3JrIChyZXF1ZXN0LCBtZXNzYWdlLFxuICogICAgIGNvbW1hbmQpICsgdGhlIHRyaXBsZSBzY29wZSBlbnRyeSAocHJvdmlkZXIgQUxTLCBPVEVMIGdsb2JhbCBjb250ZXh0LFxuICogICAgIGFzeW5jLWZsb3cgcm9vdCBmcmFtZSk7IGZyYW1ld29yayB3aXJpbmcgaXMgUkVBRE1FIHJlY2lwZXMgb24gdG9wXG4gKiAgIC0gZmVlZFByZVJvb3QoKS9mZWVkVmFsaWRhdGVkUHJlUm9vdCgpL2dldFByZVJvb3QoKSDigJQgdGh1bmRlcnN0cnVja1xuICogICAgIHByZS1yb290IGZvcmVuc2ljcyBzdG9yZSAoaWRlbnRpdHktY29ycmVsYXRlZCwgcmVxdWVzdC1saWZldGltZSlcbiAqICAgLSBmZWVkUHJlUm9vdEZyb21SZXF1ZXN0KCkg4oCUIGJvdW5kYXJ5IGhlbHBlciBvdmVyIGFueSBIVFRQIHJlcXVlc3RcbiAqICAgLSBidWlsZFVuYmxpbmRSZXBvcnQoKS9yZWNvcmRVbmJsaW5kVGVsZW1ldHJ5KCkg4oCUIHRoZSBVbmJsaW5kZXIgY29yZVxuICogICAtIGlzTW5lbW9uaWNhSW5zdGFuY2UoKSDigJQgcmVhbG0tc2FmZSB0eXBlIGd1YXJkXG4gKiAgIC0gZm9ybWF0RmxvdygpL2Vycm9yQ29udGV4dCgpIOKAlCByZWFkLXNpZGUgaGVscGVycyBvdmVyIGRpdmUncyB0cmFjZVxuICovXG5cbmV4cG9ydCB7IGF0dGFjaEhvb2tzIH0gZnJvbSAnLi9ob29rcy9hdHRhY2gtaG9va3MuanMnO1xuZXhwb3J0IHsgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMvbW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMnO1xuZXhwb3J0IHsgRGl2ZU90ZWxQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXJzL2RpdmUtb3RlbC5wcm92aWRlci5qcyc7XG5leHBvcnQgeyBBc3luY0Zsb3dQcm92aWRlciwgdHlwZSBGbG93RnJhbWUsIHR5cGUgQ3Jhc2hDb250ZXh0IH0gZnJvbSAnLi9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci5qcyc7XG5leHBvcnQgeyBydW5JbkVudHJ5U2NvcGUsIHR5cGUgRW50cnlEZWZpbml0aW9uLCB0eXBlIEVudHJ5U2NvcGVEZXBzIH0gZnJvbSAnLi9lbnRyeS1zY29wZS5qcyc7XG5leHBvcnQge1xuXHRmZWVkUHJlUm9vdCxcblx0ZmVlZFZhbGlkYXRlZFByZVJvb3QsXG5cdGdldFByZVJvb3QsXG5cdHR5cGUgUmF3UHJlUm9vdFBheWxvYWQsXG5cdHR5cGUgUHJlUm9vdFJlY29yZCxcblx0dHlwZSBQcmVSb290RGF0YSxcbn0gZnJvbSAnLi90aHVuZGVyc3RydWNrL3ByZS1yb290LmpzJztcbmV4cG9ydCB7XG5cdGJ1aWxkVW5ibGluZFJlcG9ydCxcblx0cmVjb3JkVW5ibGluZFRlbGVtZXRyeSxcblx0ZXh0cmFjdFNhZmUsXG5cdGVycm9yZWRBcmdzU2FmZSxcblx0c3RyaW5naWZ5U2FmZSxcblx0dHlwZSBVbmJsaW5kUmVwb3J0LFxufSBmcm9tICcuL3VuYmxpbmQuanMnO1xuZXhwb3J0IHsgaXNNbmVtb25pY2FJbnN0YW5jZSB9IGZyb20gJy4vdXRpbHMvaXMtbW5lbW9uaWNhLWluc3RhbmNlLmpzJztcbmV4cG9ydCB7IGZvcm1hdEZsb3csIGVycm9yQ29udGV4dCwgdHlwZSBGb3JtYXR0ZWRGbG93RWRnZSB9IGZyb20gJy4vdXRpbHMvZGl2ZS1mbG93LmpzJztcbiJdfQ==