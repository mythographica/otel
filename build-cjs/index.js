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
 *   - runInRequestScope() — one request span + triple async scope
 *   - feedPreRoot()/feedValidatedPreRoot()/getPreRoot() — thunderstruck
 *     pre-root forensics store (identity-correlated, request-lifetime)
 *   - feedPreRootFromRequest() — boundary helper over any HTTP request
 *   - buildUnblindReport()/recordUnblindTelemetry() — the Unblinder core
 *   - isMnemonicaInstance() — realm-safe type guard
 *   - formatFlow()/errorContext() — read-side helpers over dive's trace
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorContext = exports.formatFlow = exports.isMnemonicaInstance = exports.stringifySafe = exports.erroredArgsSafe = exports.extractSafe = exports.recordUnblindTelemetry = exports.buildUnblindReport = exports.feedPreRootFromRequest = exports.getPreRoot = exports.feedValidatedPreRoot = exports.feedPreRoot = exports.runInRequestScope = exports.AsyncFlowProvider = exports.DiveOtelProvider = exports.MnemonicaOtelProvider = exports.attachHooks = void 0;
var attach_hooks_js_1 = require("./hooks/attach-hooks.js");
Object.defineProperty(exports, "attachHooks", { enumerable: true, get: function () { return attach_hooks_js_1.attachHooks; } });
var mnemonica_otel_provider_js_1 = require("./providers/mnemonica-otel.provider.js");
Object.defineProperty(exports, "MnemonicaOtelProvider", { enumerable: true, get: function () { return mnemonica_otel_provider_js_1.MnemonicaOtelProvider; } });
var dive_otel_provider_js_1 = require("./providers/dive-otel.provider.js");
Object.defineProperty(exports, "DiveOtelProvider", { enumerable: true, get: function () { return dive_otel_provider_js_1.DiveOtelProvider; } });
var async_flow_provider_js_1 = require("./providers/async-flow.provider.js");
Object.defineProperty(exports, "AsyncFlowProvider", { enumerable: true, get: function () { return async_flow_provider_js_1.AsyncFlowProvider; } });
var request_scope_js_1 = require("./request-scope.js");
Object.defineProperty(exports, "runInRequestScope", { enumerable: true, get: function () { return request_scope_js_1.runInRequestScope; } });
var pre_root_js_1 = require("./thunderstruck/pre-root.js");
Object.defineProperty(exports, "feedPreRoot", { enumerable: true, get: function () { return pre_root_js_1.feedPreRoot; } });
Object.defineProperty(exports, "feedValidatedPreRoot", { enumerable: true, get: function () { return pre_root_js_1.feedValidatedPreRoot; } });
Object.defineProperty(exports, "getPreRoot", { enumerable: true, get: function () { return pre_root_js_1.getPreRoot; } });
var feed_from_request_js_1 = require("./thunderstruck/feed-from-request.js");
Object.defineProperty(exports, "feedPreRootFromRequest", { enumerable: true, get: function () { return feed_from_request_js_1.feedPreRootFromRequest; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRzs7O0FBRUgsMkRBQXNEO0FBQTdDLDhHQUFBLFdBQVcsT0FBQTtBQUNwQixxRkFBK0U7QUFBdEUsbUlBQUEscUJBQXFCLE9BQUE7QUFDOUIsMkVBQXFFO0FBQTVELHlIQUFBLGdCQUFnQixPQUFBO0FBQ3pCLDZFQUEwRztBQUFqRywySEFBQSxpQkFBaUIsT0FBQTtBQUMxQix1REFBMkg7QUFBbEgscUhBQUEsaUJBQWlCLE9BQUE7QUFDMUIsMkRBT3FDO0FBTnBDLDBHQUFBLFdBQVcsT0FBQTtBQUNYLG1IQUFBLG9CQUFvQixPQUFBO0FBQ3BCLHlHQUFBLFVBQVUsT0FBQTtBQUtYLDZFQUF5SDtBQUFoSCw4SEFBQSxzQkFBc0IsT0FBQTtBQUMvQiwyQ0FPc0I7QUFOckIsZ0hBQUEsa0JBQWtCLE9BQUE7QUFDbEIsb0hBQUEsc0JBQXNCLE9BQUE7QUFDdEIseUdBQUEsV0FBVyxPQUFBO0FBQ1gsNkdBQUEsZUFBZSxPQUFBO0FBQ2YsMkdBQUEsYUFBYSxPQUFBO0FBR2QsNkVBQXVFO0FBQTlELCtIQUFBLG1CQUFtQixPQUFBO0FBQzVCLHFEQUF3RjtBQUEvRSwwR0FBQSxVQUFVLE9BQUE7QUFBRSw0R0FBQSxZQUFZLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBtbmVtb25pY2Evb3RlbCDigJQgdGhlIGZyYW1ld29yay1mcmVlIE5vZGUuanMgY29yZSBvZiB0aGUgbW5lbW9uaWNhXG4gKiBvYnNlcnZhYmlsaXR5IHN0YWNrLlxuICpcbiAqIEV2ZXJ5dGhpbmcgaGVyZSB3b3JrcyBpbiBBTlkgTm9kZS5qcyBydW50aW1lIChFeHByZXNzLCBGYXN0aWZ5LCByYXdcbiAqIGh0dHAsIHF1ZXVlIGNvbnN1bWVycywgQ0xJKTsgZnJhbWV3b3JrIHdpcmluZyBsaXZlcyBpbiBkZWRpY2F0ZWRcbiAqIGFkYXB0ZXIgcGFja2FnZXMgYnVpbHQgb24gdGhlc2UgcHJpbWl0aXZlcy5cbiAqXG4gKiBQcm92aWRlczpcbiAqICAgLSBhdHRhY2hIb29rcygpIOKAlCBtbmVtb25pY2EgbGlmZWN5Y2xlIOKGkiBkaXZlIGVkZ2Ugd2lyaW5nXG4gKiAgIC0gTW5lbW9uaWNhT3RlbFByb3ZpZGVyIOKAlCBPVGVsIHNwYW5zIGZvciBjb25zdHJ1Y3Rpb25zXG4gKiAgIC0gRGl2ZU90ZWxQcm92aWRlciDigJQgT1RlbCBzcGFucyBmb3IgZXZlcnkgZGl2ZS13cmFwcGVkIGNhbGxcbiAqICAgLSBBc3luY0Zsb3dQcm92aWRlciDigJQgQUxTIGJhY2tib25lIGF0dHJpYnV0aW5nIHVud3JhcHBlZCBhc3luYyBob3BzXG4gKiAgIC0gcnVuSW5SZXF1ZXN0U2NvcGUoKSDigJQgb25lIHJlcXVlc3Qgc3BhbiArIHRyaXBsZSBhc3luYyBzY29wZVxuICogICAtIGZlZWRQcmVSb290KCkvZmVlZFZhbGlkYXRlZFByZVJvb3QoKS9nZXRQcmVSb290KCkg4oCUIHRodW5kZXJzdHJ1Y2tcbiAqICAgICBwcmUtcm9vdCBmb3JlbnNpY3Mgc3RvcmUgKGlkZW50aXR5LWNvcnJlbGF0ZWQsIHJlcXVlc3QtbGlmZXRpbWUpXG4gKiAgIC0gZmVlZFByZVJvb3RGcm9tUmVxdWVzdCgpIOKAlCBib3VuZGFyeSBoZWxwZXIgb3ZlciBhbnkgSFRUUCByZXF1ZXN0XG4gKiAgIC0gYnVpbGRVbmJsaW5kUmVwb3J0KCkvcmVjb3JkVW5ibGluZFRlbGVtZXRyeSgpIOKAlCB0aGUgVW5ibGluZGVyIGNvcmVcbiAqICAgLSBpc01uZW1vbmljYUluc3RhbmNlKCkg4oCUIHJlYWxtLXNhZmUgdHlwZSBndWFyZFxuICogICAtIGZvcm1hdEZsb3coKS9lcnJvckNvbnRleHQoKSDigJQgcmVhZC1zaWRlIGhlbHBlcnMgb3ZlciBkaXZlJ3MgdHJhY2VcbiAqL1xuXG5leHBvcnQgeyBhdHRhY2hIb29rcyB9IGZyb20gJy4vaG9va3MvYXR0YWNoLWhvb2tzLmpzJztcbmV4cG9ydCB7IE1uZW1vbmljYU90ZWxQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXJzL21uZW1vbmljYS1vdGVsLnByb3ZpZGVyLmpzJztcbmV4cG9ydCB7IERpdmVPdGVsUHJvdmlkZXIgfSBmcm9tICcuL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIuanMnO1xuZXhwb3J0IHsgQXN5bmNGbG93UHJvdmlkZXIsIHR5cGUgRmxvd0ZyYW1lLCB0eXBlIENyYXNoQ29udGV4dCB9IGZyb20gJy4vcHJvdmlkZXJzL2FzeW5jLWZsb3cucHJvdmlkZXIuanMnO1xuZXhwb3J0IHsgcnVuSW5SZXF1ZXN0U2NvcGUsIHR5cGUgSHR0cFJlcXVlc3RMaWtlLCB0eXBlIEh0dHBSZXNwb25zZUxpa2UsIHR5cGUgUmVxdWVzdFNjb3BlRGVwcyB9IGZyb20gJy4vcmVxdWVzdC1zY29wZS5qcyc7XG5leHBvcnQge1xuXHRmZWVkUHJlUm9vdCxcblx0ZmVlZFZhbGlkYXRlZFByZVJvb3QsXG5cdGdldFByZVJvb3QsXG5cdHR5cGUgUmF3UHJlUm9vdFBheWxvYWQsXG5cdHR5cGUgUHJlUm9vdFJlY29yZCxcblx0dHlwZSBQcmVSb290RGF0YSxcbn0gZnJvbSAnLi90aHVuZGVyc3RydWNrL3ByZS1yb290LmpzJztcbmV4cG9ydCB7IGZlZWRQcmVSb290RnJvbVJlcXVlc3QsIHR5cGUgUmVxdWVzdExpa2UsIHR5cGUgRmVlZFByZVJvb3RPcHRpb25zIH0gZnJvbSAnLi90aHVuZGVyc3RydWNrL2ZlZWQtZnJvbS1yZXF1ZXN0LmpzJztcbmV4cG9ydCB7XG5cdGJ1aWxkVW5ibGluZFJlcG9ydCxcblx0cmVjb3JkVW5ibGluZFRlbGVtZXRyeSxcblx0ZXh0cmFjdFNhZmUsXG5cdGVycm9yZWRBcmdzU2FmZSxcblx0c3RyaW5naWZ5U2FmZSxcblx0dHlwZSBVbmJsaW5kUmVwb3J0LFxufSBmcm9tICcuL3VuYmxpbmQuanMnO1xuZXhwb3J0IHsgaXNNbmVtb25pY2FJbnN0YW5jZSB9IGZyb20gJy4vdXRpbHMvaXMtbW5lbW9uaWNhLWluc3RhbmNlLmpzJztcbmV4cG9ydCB7IGZvcm1hdEZsb3csIGVycm9yQ29udGV4dCwgdHlwZSBGb3JtYXR0ZWRGbG93RWRnZSB9IGZyb20gJy4vdXRpbHMvZGl2ZS1mbG93LmpzJztcbiJdfQ==