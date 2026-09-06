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
For simple frameworks the recipes below are all you need.

## Install

```bash
npm install @mnemonica/otel mnemonica @mnemonica/dive @opentelemetry/api
```

`mnemonica`, `@mnemonica/dive` and `@opentelemetry/api` are peer
dependencies — they are process singletons (the type registry, the edge
ring, the OTel API), so the app must own exactly one copy of each.

Dual build: ESM (`import`) and CommonJS (`require`) both work. The CJS
flavor loads `@mnemonica/dive` through `require(esm)`, so `require()`
consumers need Node ≥ 20.19 / 22.

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

## License

MIT
