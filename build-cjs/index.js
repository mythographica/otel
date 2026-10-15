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
 *   - stampConstructions()/startLinkedSpan() — the lineage link: the
 *     cross-language contract attributes stamped on the span current at
 *     construction, and post-request spans LINKED to the construction span
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
exports.errorContext = exports.formatFlow = exports.isMnemonicaInstance = exports.recordErrorAnalysis = exports.analyseError = exports.captureError = exports.getPreRoot = exports.feedValidatedPreRoot = exports.feedPreRoot = exports.runInEntryScope = exports.defaultDiveApi = exports.AsyncFlowProvider = exports.DiveOtelProvider = exports.ATTR_TYPE_PATH = exports.ATTR_TYPE_COLLECTION = exports.ATTR_PARENT_ID = exports.ATTR_INSTANCE_ID = exports.startLinkedSpan = exports.stampConstructions = exports.MnemonicaOtelProvider = exports.attachHooks = void 0;
var attach_hooks_js_1 = require("./hooks/attach-hooks.js");
Object.defineProperty(exports, "attachHooks", { enumerable: true, get: function () { return attach_hooks_js_1.attachHooks; } });
var mnemonica_otel_provider_js_1 = require("./providers/mnemonica-otel.provider.js");
Object.defineProperty(exports, "MnemonicaOtelProvider", { enumerable: true, get: function () { return mnemonica_otel_provider_js_1.MnemonicaOtelProvider; } });
var lineage_link_js_1 = require("./lineage-link.js");
Object.defineProperty(exports, "stampConstructions", { enumerable: true, get: function () { return lineage_link_js_1.stampConstructions; } });
Object.defineProperty(exports, "startLinkedSpan", { enumerable: true, get: function () { return lineage_link_js_1.startLinkedSpan; } });
Object.defineProperty(exports, "ATTR_INSTANCE_ID", { enumerable: true, get: function () { return lineage_link_js_1.ATTR_INSTANCE_ID; } });
Object.defineProperty(exports, "ATTR_PARENT_ID", { enumerable: true, get: function () { return lineage_link_js_1.ATTR_PARENT_ID; } });
Object.defineProperty(exports, "ATTR_TYPE_COLLECTION", { enumerable: true, get: function () { return lineage_link_js_1.ATTR_TYPE_COLLECTION; } });
Object.defineProperty(exports, "ATTR_TYPE_PATH", { enumerable: true, get: function () { return lineage_link_js_1.ATTR_TYPE_PATH; } });
var dive_otel_provider_js_1 = require("./providers/dive-otel.provider.js");
Object.defineProperty(exports, "DiveOtelProvider", { enumerable: true, get: function () { return dive_otel_provider_js_1.DiveOtelProvider; } });
var async_flow_provider_js_1 = require("./providers/async-flow.provider.js");
Object.defineProperty(exports, "AsyncFlowProvider", { enumerable: true, get: function () { return async_flow_provider_js_1.AsyncFlowProvider; } });
var dive_api_js_1 = require("./dive-api.js");
Object.defineProperty(exports, "defaultDiveApi", { enumerable: true, get: function () { return dive_api_js_1.defaultDiveApi; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTBCRzs7O0FBRUgsMkRBRWlDO0FBRGhDLDhHQUFBLFdBQVcsT0FBQTtBQUVaLHFGQUErRTtBQUF0RSxtSUFBQSxxQkFBcUIsT0FBQTtBQUM5QixxREFPMkI7QUFOMUIscUhBQUEsa0JBQWtCLE9BQUE7QUFDbEIsa0hBQUEsZUFBZSxPQUFBO0FBQ2YsbUhBQUEsZ0JBQWdCLE9BQUE7QUFDaEIsaUhBQUEsY0FBYyxPQUFBO0FBQ2QsdUhBQUEsb0JBQW9CLE9BQUE7QUFDcEIsaUhBQUEsY0FBYyxPQUFBO0FBRWYsMkVBQXFFO0FBQTVELHlIQUFBLGdCQUFnQixPQUFBO0FBQ3pCLDZFQUU0QztBQUQzQywySEFBQSxpQkFBaUIsT0FBQTtBQUVsQiw2Q0FFdUI7QUFEdEIsNkdBQUEsY0FBYyxPQUFBO0FBRWYsbURBRTBCO0FBRHpCLGlIQUFBLGVBQWUsT0FBQTtBQUVoQiwyREFPcUM7QUFOcEMsMEdBQUEsV0FBVyxPQUFBO0FBQ1gsbUhBQUEsb0JBQW9CLE9BQUE7QUFDcEIseUdBQUEsVUFBVSxPQUFBO0FBS1gseURBVTZCO0FBVDVCLGlIQUFBLFlBQVksT0FBQTtBQUNaLGlIQUFBLFlBQVksT0FBQTtBQUNaLHdIQUFBLG1CQUFtQixPQUFBO0FBUXBCLDZFQUF1RTtBQUE5RCwrSEFBQSxtQkFBbUIsT0FBQTtBQUM1QixxREFFOEI7QUFEN0IsMEdBQUEsVUFBVSxPQUFBO0FBQUUsNEdBQUEsWUFBWSxPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbW5lbW9uaWNhL290ZWwg4oCUIHRoZSBmcmFtZXdvcmstZnJlZSBOb2RlLmpzIGNvcmUgb2YgdGhlIG1uZW1vbmljYVxuICogb2JzZXJ2YWJpbGl0eSBzdGFjay5cbiAqXG4gKiBFdmVyeXRoaW5nIGhlcmUgd29ya3MgaW4gQU5ZIE5vZGUuanMgcnVudGltZSAoRXhwcmVzcywgRmFzdGlmeSwgcmF3XG4gKiBodHRwLCBxdWV1ZSBjb25zdW1lcnMsIENMSSk7IGZyYW1ld29yayB3aXJpbmcgbGl2ZXMgaW4gZGVkaWNhdGVkXG4gKiBhZGFwdGVyIHBhY2thZ2VzIGJ1aWx0IG9uIHRoZXNlIHByaW1pdGl2ZXMuXG4gKlxuICogUHJvdmlkZXM6XG4gKiAgIC0gYXR0YWNoSG9va3MoKSDigJQgbW5lbW9uaWNhIGxpZmVjeWNsZSDihpIgZGl2ZSBlZGdlIHdpcmluZ1xuICogICAtIE1uZW1vbmljYU90ZWxQcm92aWRlciDigJQgT1RlbCBzcGFucyBmb3IgY29uc3RydWN0aW9uc1xuICogICAtIHN0YW1wQ29uc3RydWN0aW9ucygpL3N0YXJ0TGlua2VkU3BhbigpIOKAlCB0aGUgbGluZWFnZSBsaW5rOiB0aGVcbiAqICAgICBjcm9zcy1sYW5ndWFnZSBjb250cmFjdCBhdHRyaWJ1dGVzIHN0YW1wZWQgb24gdGhlIHNwYW4gY3VycmVudCBhdFxuICogICAgIGNvbnN0cnVjdGlvbiwgYW5kIHBvc3QtcmVxdWVzdCBzcGFucyBMSU5LRUQgdG8gdGhlIGNvbnN0cnVjdGlvbiBzcGFuXG4gKiAgIC0gRGl2ZU90ZWxQcm92aWRlciDigJQgT1RlbCBzcGFucyBmb3IgZXZlcnkgZGl2ZS13cmFwcGVkIGNhbGxcbiAqICAgLSBBc3luY0Zsb3dQcm92aWRlciDigJQgQUxTIGJhY2tib25lIGF0dHJpYnV0aW5nIHVud3JhcHBlZCBhc3luYyBob3BzXG4gKiAgIC0gcnVuSW5FbnRyeVNjb3BlKCkg4oCUIG9uZSByb290IHNwYW4gcGVyIHVuaXQgb2Ygd29yayAocmVxdWVzdCwgbWVzc2FnZSxcbiAqICAgICBjb21tYW5kKSArIHRoZSB0cmlwbGUgc2NvcGUgZW50cnkgKHByb3ZpZGVyIEFMUywgT1RFTCBnbG9iYWwgY29udGV4dCxcbiAqICAgICBhc3luYy1mbG93IHJvb3QgZnJhbWUpOyBmcmFtZXdvcmsgd2lyaW5nIGlzIFJFQURNRSByZWNpcGVzIG9uIHRvcFxuICogICAtIGZlZWRQcmVSb290KCkvZmVlZFZhbGlkYXRlZFByZVJvb3QoKS9nZXRQcmVSb290KCkg4oCUIHRodW5kZXJzdHJ1Y2tcbiAqICAgICBwcmUtcm9vdCBmb3JlbnNpY3Mgc3RvcmUgKGlkZW50aXR5LWNvcnJlbGF0ZWQsIHJlcXVlc3QtbGlmZXRpbWUpXG4gKiAgIC0gY2FwdHVyZUVycm9yKCkvYW5hbHlzZUVycm9yKCkvcmVjb3JkRXJyb3JBbmFseXNpcygpIOKAlCB0aGUgZXJyb3JcbiAqICAgICBhbmFseXNpczogZXJyb3Ig4oaSIGl0cyBkaXZlIGVkZ2Ug4oaSIGl0cyBpbnN0YW5jZXMgKGRhdGEgcmV0dXJuZWQsIG5ldmVyXG4gKiAgICAgcHJpbnRlZCk7IHRoZSBsaW5lYWdlIGdyYXBoIHJpZGVzIGEgc3BhbiBldmVudCB0aGUgY2FsbGVyIHBhc3Nlc1xuICogICAtIGlzTW5lbW9uaWNhSW5zdGFuY2UoKSDigJQgcmVhbG0tc2FmZSB0eXBlIGd1YXJkXG4gKiAgIC0gZm9ybWF0RmxvdygpL2Vycm9yQ29udGV4dCgpIOKAlCByZWFkLXNpZGUgaGVscGVycyBvdmVyIGRpdmUncyB0cmFjZVxuICovXG5cbmV4cG9ydCB7XG5cdGF0dGFjaEhvb2tzLCB0eXBlIEF0dGFjaEhvb2tzT3B0aW9ucyBcbn0gZnJvbSAnLi9ob29rcy9hdHRhY2gtaG9va3MuanMnO1xuZXhwb3J0IHsgTW5lbW9uaWNhT3RlbFByb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMvbW5lbW9uaWNhLW90ZWwucHJvdmlkZXIuanMnO1xuZXhwb3J0IHtcblx0c3RhbXBDb25zdHJ1Y3Rpb25zLFxuXHRzdGFydExpbmtlZFNwYW4sXG5cdEFUVFJfSU5TVEFOQ0VfSUQsXG5cdEFUVFJfUEFSRU5UX0lELFxuXHRBVFRSX1RZUEVfQ09MTEVDVElPTixcblx0QVRUUl9UWVBFX1BBVEgsXG59IGZyb20gJy4vbGluZWFnZS1saW5rLmpzJztcbmV4cG9ydCB7IERpdmVPdGVsUHJvdmlkZXIgfSBmcm9tICcuL3Byb3ZpZGVycy9kaXZlLW90ZWwucHJvdmlkZXIuanMnO1xuZXhwb3J0IHtcblx0QXN5bmNGbG93UHJvdmlkZXIsIHR5cGUgRmxvd0ZyYW1lLCB0eXBlIENyYXNoQ29udGV4dCBcbn0gZnJvbSAnLi9wcm92aWRlcnMvYXN5bmMtZmxvdy5wcm92aWRlci5qcyc7XG5leHBvcnQge1xuXHRkZWZhdWx0RGl2ZUFwaSwgdHlwZSBEaXZlQXBpLCB0eXBlIERpdmVPcHRpb24gXG59IGZyb20gJy4vZGl2ZS1hcGkuanMnO1xuZXhwb3J0IHtcblx0cnVuSW5FbnRyeVNjb3BlLCB0eXBlIEVudHJ5RGVmaW5pdGlvbiwgdHlwZSBFbnRyeVNjb3BlRGVwcyBcbn0gZnJvbSAnLi9lbnRyeS1zY29wZS5qcyc7XG5leHBvcnQge1xuXHRmZWVkUHJlUm9vdCxcblx0ZmVlZFZhbGlkYXRlZFByZVJvb3QsXG5cdGdldFByZVJvb3QsXG5cdHR5cGUgUmF3UHJlUm9vdFBheWxvYWQsXG5cdHR5cGUgUHJlUm9vdFJlY29yZCxcblx0dHlwZSBQcmVSb290RGF0YSxcbn0gZnJvbSAnLi90aHVuZGVyc3RydWNrL3ByZS1yb290LmpzJztcbmV4cG9ydCB7XG5cdGNhcHR1cmVFcnJvcixcblx0YW5hbHlzZUVycm9yLFxuXHRyZWNvcmRFcnJvckFuYWx5c2lzLFxuXHR0eXBlIEVycm9yU291cmNlLFxuXHR0eXBlIEVycm9yQW5hbHlzaXMsXG5cdHR5cGUgRXJyb3JDYXB0dXJlLFxuXHR0eXBlIEVycm9yQW5hbHlzaXNEZXBzLFxuXHR0eXBlIEFuYWx5c2lzQnVkZ2V0LFxuXHR0eXBlIEFuYWx5c2VkRWRnZSxcbn0gZnJvbSAnLi9lcnJvci1hbmFseXNpcy5qcyc7XG5leHBvcnQgeyBpc01uZW1vbmljYUluc3RhbmNlIH0gZnJvbSAnLi91dGlscy9pcy1tbmVtb25pY2EtaW5zdGFuY2UuanMnO1xuZXhwb3J0IHtcblx0Zm9ybWF0RmxvdywgZXJyb3JDb250ZXh0LCB0eXBlIEZvcm1hdHRlZEZsb3dFZGdlIFxufSBmcm9tICcuL3V0aWxzL2RpdmUtZmxvdy5qcyc7XG4iXX0=