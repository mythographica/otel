# AGENTS.md — @mnemonica/otel

Guidance for AI agents modifying this package. If you are *using* the
package in your own project, start with [`README.md`](./README.md).

## What this is

The framework-free Node.js core of the mnemonica observability stack —
everything a framework adapter needs that has nothing to do with the
framework itself. It connects two engines into any Node runtime:

- **mnemonica** — instance inheritance (`define()`, lineage in the
  prototype chain)
- **@mnemonica/dive** — execution-flow tracing (context pinned to
  instances, errors carrying their data)

This package adds no framework semantics of its own and imports no
framework: HTTP touchpoints are structural types (`RequestLike`,
`HttpRequestLike`, `HttpResponseLike`). It is the Node boundary where
`async_hooks` is free — dive itself stays engine-only (Deno/Bun) and must
never import `async_hooks`; ALS lives here.

**Hard rule: no framework vocabulary in this package.** Source, comments
and docs must not name any specific web framework's adapter package or
reference framework-specific lifecycles. If a sentence only makes sense
for one framework, it belongs in that framework's adapter repo.

## File map

| Path | Role |
|---|---|
| `src/hooks/attach-hooks.ts` | wires a TypesCollection to dive's lifecycle tracing — the only place that knows mnemonica's hook contract |
| `src/providers/mnemonica-otel.provider.ts` | OTel spans for constructions; pending spans keyed on the per-call args array; parent found via own ALS then the prototype chain |
| `src/providers/dive-otel.provider.ts` | OTel spans over dive's edge hooks — spans every wrapped call, parented on dive's trace; publishes edgeId→traceId on bounded `globalThis.__mnemonicaDiveTraceIds` for the strategy push channel |
| `src/providers/async-flow.provider.ts` | ALS backbone: FlowFrame linked list — enter pushes, leave restores; unwrapped async hops inherit the parental frame; root pinSet holds context instances for the scope's lifetime |
| `src/request-scope.ts` | `runInRequestScope` — one OTel span per HTTP request + triple scope entry (provider ALS, OTEL global context, async-flow root frame) |
| `src/thunderstruck/pre-root.ts` | the pre-root store: WeakMap-keyed on request payload objects |
| `src/thunderstruck/feed-from-request.ts` | `feedPreRootFromRequest` — boundary shaping for any framework's request |
| `src/unblind.ts` | `buildUnblindReport` / `recordUnblindTelemetry` — the Unblinder core (framework wrappers own the body discipline) |
| `src/utils/is-mnemonica-instance.ts` | realm-safe type guard via `getProps()` |
| `src/utils/dive-flow.ts` | `formatFlow` / `errorContext` — read-side helpers over dive's trace |

## Invariants (do not break these)

1. **Pre-root correlation is by object identity.** The pre-root store is a
   `WeakMap` keyed on the exact request payload objects (body, query,
   params, headers). Re-parsed copies, primitives, and cross-request
   objects must not resolve. No ALS in the pre-root path — the
   AsyncFlowProvider's ALS is a separate concern (dive-edge attribution)
   and must never participate in pre-root correlation.
2. **Retention is the request's lifetime.** There is no store-draining or
   release step by design; the ephemeron semantics are the feature. Do not
   add manual cleanup APIs.
3. **Headers are fed whole, on purpose** (correlation ids). Redaction is a
   planned separate task — do not silently strip fields.
4. **The unblind names are a contract.** `report.kind`
   (`'caught-unblinded'`), the span name (`'mnemonica.caught-exception'`)
   and the `[unblind]` stdout marker are pinned downstream (runbooks grep
   the marker; framework adapters pin the report shape). Keep them stable.
5. **Peers are process singletons.** `mnemonica` (type registry),
   `@mnemonica/dive` (edge ring) and `@opentelemetry/api` must each exist
   exactly once in the consumer's process. Never move them into
   `dependencies` here (dive's dual listing mirrors the historical adapter
   layout and is the deliberate exception).

## Build & test

```bash
npm run build   # tsc → build/ (ESM) + build-cjs/ (CJS, tsconfig.cjs.json)
npm test        # vitest run (52 tests, incl. the CJS smoke)
```

Both must be green before a change is done. `prepublishOnly` runs build +
tests + `scripts/assert-clean-build.js`: this repo TRACKS `build/` and
`build-cjs/` in git and publishes them, so the rule is **publish committed
files** — the gate fails the publish if the rebuild leaves either dirty.
Fix: `npm run build && git add build/ build-cjs/ && git commit`.

**Testing rule:** behavior changes must break a test. Pin behavior with
snapshot-like assertions — deep-equal the full observed shape (edge kinds,
statuses, durations), not just the fields you touched.

**OTel global registration in tests:** `NodeTracerProvider.register()` is
a no-op after the first call per process — test files that exercise the
GLOBAL tracer (`trace.getTracer`, e.g. `recordUnblindTelemetry`) must
register once per file and `exporter.reset()` between tests; a second
provider silently orphans its exporter (see `test/unblind.spec.ts`).

**CJS build notes:** `tsconfig.cjs.json` compiles the same src/ with
`module: CommonJS` into `build-cjs/`; `scripts/write-cjs-marker.js` drops
a `{"type":"commonjs"}` package.json there. Its `paths` shim maps
`mnemonica/module` types to core's `build/index.d.ts` because Node10
resolution ignores the exports map — at runtime the `require` condition
resolves straight to core's CJS build, so both flavors share the one
mnemonica singleton (the CJS smoke asserts exactly that). The CJS flavor
loads dive through `require(esm)` — Node ≥ 20.19 / 22.

**vitest config caveat:** `vitest.config.ts` aliases `mnemonica` to
`../core/module/index.js` when that sibling checkout exists (local dev
against live core source), guarded by `fs.existsSync`. On CI and fresh
clones the alias drops out and the registry `mnemonica` is used. Do not
remove the guard.

## Ecosystem position

This is the engine room between `mnemonica` + `@mnemonica/dive` and the
framework adapter packages. Framework adapters are thin wrappers over
`runInRequestScope` / `feedPreRootFromRequest` / `buildUnblindReport` for
simple frameworks (Express/Fastify — a few lines, recipe in the README),
and full packages for frameworks with their own DI/pipe/decorator
lifecycles. Changes to mnemonica's construction semantics or dive's trace
record shape ripple here first, then to the adapters.
