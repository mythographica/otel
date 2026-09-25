# @mnemonica/otel

The framework-free Node.js core of the mnemonica observability stack.

This package is everything a framework adapter needs that has nothing to
do with any framework: the dive hook wiring, the OpenTelemetry providers,
the ALS async-flow backbone, the thunderstruck pre-root forensics store,
and the Unblinder error reports — all against plain structural types, so
they run in Express, Fastify, raw `http`, queue consumers, and CLIs
unchanged.

- [`mnemonica`](https://www.npmjs.com/package/mnemonica) — instance
  inheritance; lineage carried in the prototype chain.
- [`@mnemonica/dive`](https://www.npmjs.com/package/@mnemonica/dive) —
  execution-flow tracing engine (no ALS, no async_hooks).
- **this package** — the Node boundary: dive wiring + telemetry + the ALS
  backbone (Node-only by design — dive stays engine-only for Deno/Bun,
  ALS lives here where it is free).

Framework wiring is layered on top, never inside: frameworks with their
own DI container, pipes, interceptors and decorator lifecycles get a
dedicated first-party adapter package in the `@mnemonica` org — that
wiring is genuinely complicated and must be packaged and tested as such.
**NestJS is the first of these: use
[`@mnemonica/nestjs`](https://www.npmjs.com/package/@mnemonica/nestjs)
(interceptor-level request boundary, DI-scoped context, `attachHooks` at
module init) — do not wire this package by hand under NestJS.**
For simple frameworks the recipes below are all you need.

## Install

```bash
npm install @mnemonica/otel mnemonica @mnemonica/dive @opentelemetry/api
```

`mnemonica`, `@mnemonica/dive` and `@opentelemetry/api` are peer
dependencies — they are process singletons (the type registry, the trace,
the OTel API), so the app must own exactly one copy of each.

Dual build: ESM (`import`) and CommonJS (`require`) both work. With
`@mnemonica/dive` ≥ 0.9.0 the `require()` chain is plain CJS end-to-end
(dive's exports map carries a `require` condition); against older dive
versions the CJS flavor loads dive through `require(esm)`, needing
Node ≥ 20.19 / 22.

## What's inside

| Export | Role |
|---|---|
| `attachHooks(collection)` | wires a mnemonica TypesCollection to dive's lifecycle tracing (create edges + wrapped methods + context-carrying constructor args) |
| `MnemonicaOtelProvider` | OTel spans for mnemonica constructions (pre/post/error), parented by lineage, ALS-propagated |
| `DiveOtelProvider` | OTel spans for EVERY dive-wrapped call, parented on dive's own trace; async spans close at settle |
| `AsyncFlowProvider` | the ALS backbone: attributes UNWRAPPED async hops (timers, promise continuations, generator suspensions) to the parental dive edge; pins context instances for the scope's lifetime |
| `runInRequestScope(req, res, deps, fn)` | one OTel span per HTTP request + the triple async scope (provider ALS, OTEL global context, async-flow root frame) |
| `feedPreRoot` / `feedValidatedPreRoot` / `getPreRoot` | thunderstruck pre-root store: request payloads correlated by OBJECT IDENTITY (WeakMap), retention = the request's lifetime |
| `feedPreRootFromRequest(req, opts?)` | the boundary helper: shapes any framework's request into the pre-root feed |
| `buildUnblindReport(error)` / `recordUnblindTelemetry(report, error)` | the Unblinder core: the dive branch + errored construction + attempted args, plus the unconditional span and stdout marker |
| `isMnemonicaInstance(value)` | realm-safe type guard via `getProps()` |
| `formatFlow(target?)` / `errorContext(error)` | read-side helpers over dive's trace |

## What you get in your traces

With the wiring below, one HTTP request produces ONE coherent trace:

```
HTTP POST /users                  ← request span (runInRequestScope)
├─ mnemonica.UserEntity           ← construction span (MnemonicaOtelProvider)
│  └─ mnemonica.UserResponse      ←   parented on the prototype lineage
├─ UserService.createUser         ← call span (DiveOtelProvider)
│  └─ …                           ←   async hops attributed (AsyncFlowProvider)
└─ mnemonica.caught-exception     ← on failure only: the Unblinder span
```

- **Construction spans follow the prototype chain.** `MnemonicaOtelProvider`
  emits `mnemonica.<TypeName>` spans and parents each
  `new instance.SubType()` on the span of the instance it was constructed
  from — the trace tree IS the data-flow lineage, not the call stack. Span
  attributes carry `mnemonica.type_name` and the lifecycle `mnemonica.hook`.
- **Call spans follow dive's trace.** `DiveOtelProvider` turns every
  dive-wrapped invocation into a span parented on dive's own edge graph;
  async spans close at settle, so durations are real — a queue callback
  fired 30s later measures 30s, attached to its true parent.
- **Unwrapped async hops are still attributed.** Timers, promise
  continuations and generator suspensions that nobody wrapped land under
  the parental dive edge via the `AsyncFlowProvider` ALS backbone.
- **Errors arrive with their data.** A caught exception carries the dive
  branch that led to it, the errored construction, and the attempted args —
  `buildUnblindReport` shapes it, `recordUnblindTelemetry` emits the
  `mnemonica.caught-exception` span plus the `[unblind]` stdout marker.
- **Dive edges join OTel traces.** `DiveOtelProvider` publishes
  edgeId → traceId pairs on a bounded `globalThis.__mnemonicaDiveTraceIds`
  map, so an external trace consumer reading dive's live edges can jump
  from any edge to the exact backend trace it belongs to.

## Wire it up

The package speaks the OTel **API** only — bring your own SDK and exporter:

```bash
npm install @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http
```

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// any OTel backend works; the OTLP HTTP exporter defaults to
// localhost:4318 (the Jaeger all-in-one port)
const sdk = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter())],
});
sdk.register();

import { defaultTypes } from 'mnemonica';
import {
  attachHooks,
  MnemonicaOtelProvider,
  DiveOtelProvider,
  AsyncFlowProvider,
} from '@mnemonica/otel';

const otel      = new MnemonicaOtelProvider();  // spans on constructions
const diveOtel  = new DiveOtelProvider();       // spans on wrapped calls
const asyncFlow = new AsyncFlowProvider();      // ALS attribution backbone

attachHooks(defaultTypes);        // mnemonica lifecycle → dive edges
otel.attachHooks(defaultTypes);   // mnemonica lifecycle → OTel spans
diveOtel.attach();                // dive edges → OTel spans
asyncFlow.attach();               // unwrapped async hops → parental edge
```

Attach **exactly once** per process — attaching twice doubles every span
and every frame push. Dive's `clear()` wipes subscribers, so re-attach
after calling it (tests do this in `beforeEach`). Each provider accepts a
`Tracer` of your own (`new MnemonicaOtelProvider(myTracer)`); by default
they share `trace.getTracer('@mnemonica/otel')`.

From here `otel` and `asyncFlow` are the deps the request-scope recipes
below pass around.

## Use it from your own boundary

### Express

```typescript
import { runInRequestScope, feedPreRootFromRequest } from '@mnemonica/otel';

app.use((req, res, next) => {
  feedPreRootFromRequest(req);                 // thunderstruck boundary
  runInRequestScope(req, res, { tracer, otel, asyncFlow }, () => next());
});
```

### Fastify

```typescript
fastify.addHook('onRequest', (request, reply, done) => {
  feedPreRootFromRequest(request);             // params/query/body/headers
  runInRequestScope(request.raw, reply.raw, { tracer, otel, asyncFlow }, () => done());
});
```

### Error boundary (any framework)

```typescript
import { buildUnblindReport, recordUnblindTelemetry } from '@mnemonica/otel';

// Express error middleware / Fastify setErrorHandler / process handler:
const report = buildUnblindReport(error);      // branch + errored type + args
recordUnblindTelemetry(report, error);         // span + [unblind] stdout line
if (!res.headersSent) res.status(500).json(report);
```

`report.kind` (`'caught-unblinded'`), the span name
(`'mnemonica.caught-exception'`) and the `[unblind]` stdout marker are
pinned by downstream consumers — keep them stable.

### Non-HTTP scopes (queues, CLI, tests)

```typescript
import { AsyncFlowProvider } from '@mnemonica/otel';

const asyncFlow = new AsyncFlowProvider();
asyncFlow.attach();
asyncFlow.runInScope(() => consume(message));  // root frame per job
```

## For AI agents

The contributor contract — file map, invariants, the testing gate — lives
in [`AGENTS.md`](./AGENTS.md).
