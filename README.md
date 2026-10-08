# @mnemonica/otel

The framework-free Node.js core of the mnemonica observability stack.

This package is everything a framework adapter needs that has nothing to
do with any framework: the dive hook wiring, the OpenTelemetry providers,
the ALS async-flow backbone, the thunderstruck pre-root forensics store,
and error analysis (error → its dive edge → its instances) — all against plain structural types, so
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
| `runInEntryScope(entry, deps, fn)` | one root span per unit of work (request, message, command) + the triple scope entry (provider ALS, OTEL global context, async-flow root frame) |
| `feedPreRoot` / `feedValidatedPreRoot` / `getPreRoot` | thunderstruck pre-root store: request payloads correlated by OBJECT IDENTITY (WeakMap), retention = the request's lifetime |
| `captureError(error, deps?)` / `analyseError(capture, budget?)` / `recordErrorAnalysis(analysis, span)` | the error analysis: which dive edge the error came from (four sources, evidence-labelled), the chain's instances as one lineage graph (lethe format), recorded on a span the caller passes — data returned, never printed |
| `isMnemonicaInstance(value)` | realm-safe type guard via `getProps()` |
| `formatFlow(target?)` / `errorContext(error)` | read-side helpers over dive's trace |

## What you get in your traces

With the wiring below, one entry — an HTTP request, a queue message, a CLI
command — produces ONE coherent trace:

```
HTTP POST /users                  ← entry span (runInEntryScope)
├─ mnemonica.UserEntity           ← construction span (MnemonicaOtelProvider)
│  └─ mnemonica.UserResponse      ←   parented on the prototype lineage
├─ UserService.createUser         ← call span (DiveOtelProvider)
│  └─ …                           ←   async hops attributed (AsyncFlowProvider)
└─ mnemonica.error (event)        ← on failure only: the analysis, if recorded
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
- **Errors arrive with their data.** `captureError` + `analyseError` find
  which dive edge an error came from — the error's own pin (evidence), the
  ALS frame at crash time (evidence), or the rest residue (a labelled
  guess) — and collect the chain's instances into one lineage graph.
  Nothing is printed; `recordErrorAnalysis` puts the result on a span the
  caller passes, as one `mnemonica.error` event.
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

From here `otel` and `asyncFlow` are the deps the entry-scope recipes below
pass around.

## Use it from your own boundary

Every entrypoint is a few lines of wiring over the neutral
`runInEntryScope(entry, deps, fn)` — one root span per unit of work,
current in both the mnemonica provider's store and the OTel global
context, with the async-flow root frame outermost when given. With
`endOnReturn: false` the caller owns the ending — and the error
recording: a throw inside `fn` still sets the span's error status and
records the exception, but the span is left open for the caller to end
(record and end it in the same `finish`/error handler). Return a native
promise (an async function) from `fn` if the span should cover the async
work — non-native thenables are treated as plain values, never awaited.
Recipes:

### Express

```typescript
import { runInEntryScope, feedPreRoot } from '@mnemonica/otel';

app.use((req, res, next) => {
  feedPreRoot({                                   // thunderstruck boundary
    params  : req.params,
    query   : req.query,
    body    : req.body,
    headers : req.headers,
    request : req,
  });
  runInEntryScope(
    { name: `HTTP ${req.method} ${req.route?.path ?? req.url}`, endOnReturn: false },
    { tracer, otel, asyncFlow },
    (span) => {
      res.on('finish', () => {
        span.setAttribute('http.status_code', res.statusCode);
        span.end();                               // caller owns the ending
      });
      next();
    },
  );
});
```

### Fastify

```typescript
fastify.addHook('onRequest', (request, reply, done) => {
  feedPreRoot({
    params  : request.params,
    query   : request.query,
    body    : request.body,
    headers : request.headers,
    request : request.raw,
  });
  runInEntryScope(
    { name: `HTTP ${request.method} ${request.url}`, endOnReturn: false },
    { tracer, otel, asyncFlow },
    (span) => {
      reply.raw.on('finish', () => span.end());
      done();
    },
  );
});
```

### Raw node http

```typescript
import { runInEntryScope } from '@mnemonica/otel';

const server = http.createServer((req, res) => {
  runInEntryScope(
    { name: `HTTP ${req.method} ${req.url}`, endOnReturn: false },
    { tracer, otel, asyncFlow },
    (span) => {
      res.on('finish', () => span.end());         // end with the response
      route(req, res);
    },
  );
});
```

### Queue message handler

```typescript
channel.consume(queue, (message) => {
  runInEntryScope(
    { name: `queue ${queue}`, attributes: { 'messaging.destination': queue } },
    { tracer, otel, asyncFlow },
    () => handle(message),   // ends when the returned promise settles
  );
});
```

### CLI command

```typescript
runInEntryScope(
  { name: `cli ${command}`, attributes: { 'process.command': process.argv.join(' ') } },
  { tracer, otel, asyncFlow },
  () => run(command),
).then((code) => process.exit(code));
```

### Error boundary (any framework)

```typescript
import { captureError, analyseError, recordErrorAnalysis } from '@mnemonica/otel';

// Express error middleware / Fastify setErrorHandler / process handler —
// at uncaughtException/unhandledRejection, capture synchronously, analyse
// when asked, record on the span YOU pass; what gets logged is your call:
const capture = captureError(error, { asyncFlow });   // references only
const analysis = analyseError(capture);               // the edge + instances
recordErrorAnalysis(analysis, span);                  // one mnemonica.error event
if (!res.headersSent) res.status(500).json({ message: analysis.message });
```

`analysis.source` is `'error'` | `'async-frame'` | `'last-context'` |
`'none'`, and `analysis.evidence` says whether the attribution is dive
evidence or the labelled rest-residue guess.

### Bare scopes (tests, manual frames)

```typescript
import { AsyncFlowProvider } from '@mnemonica/otel';

const asyncFlow = new AsyncFlowProvider();
asyncFlow.attach();
asyncFlow.runInScope(() => consume(message));  // root frame per job
```

## For AI agents

The contributor contract — file map, invariants, the testing gate — lives
in [`AGENTS.md`](./AGENTS.md).
