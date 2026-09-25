# SKILL.md — Wiring @mnemonica/otel into an app

Guidance for AI agents (and humans) adding `@mnemonica/otel` to a
codebase: what it is for, what to attach, and how to read the results.
The full API reference is [`README.md`](./README.md); this file is the
*how to think*.

## What this package is for — the combo

`@mnemonica/otel` is the third leg of a three-part stack; used properly,
all three work together:

- **mnemonica** — model the data: instance inheritance, lineage carried
  in the prototype chain. Types, subtypes, construction hooks.
- **@mnemonica/dive** — flow over those objects: wrap boundaries, record
  edges, pin errors to their data.
- **@mnemonica/otel** — this package: wire the two together
  (`attachHooks`) and export the result as OpenTelemetry spans.

The other two legs have their own agent guides —
[mnemonica's SKILL.md](https://www.npmjs.com/package/mnemonica) (modeling
the data as lineage) and
[@mnemonica/dive's SKILL.md](https://www.npmjs.com/package/@mnemonica/dive)
(wrap placement, the context rule, where traces end by design). Read all
three; this file only covers what otel adds on top.

One startup example, all three together:

```typescript
import { defaultTypes } from 'mnemonica';
import { wrap } from '@mnemonica/dive';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { attachHooks, DiveOtelProvider } from '@mnemonica/otel';

const sdk = new NodeTracerProvider();
sdk.register();

// 1. model the data (mnemonica)
const User = defaultTypes.define('User', function (this: { id: string }, d: { id: string }) {
	this.id = d.id;
});

// 2. wire + export (otel)
attachHooks(defaultTypes);          // mnemonica lifecycle → dive edges
const diveOtel = new DiveOtelProvider();
diveOtel.attach();                  // dive edges → OTel spans

// 3. flow over the objects (dive)
const user = new User({ id: 'u1' });
const load = wrap(function load () {
	return user.id;
}, user);
load();
```

## The one-time wiring

Attach exactly once per process, at startup, after your SDK is
registered:

```typescript
const otel      = new MnemonicaOtelProvider();  // spans on constructions
const diveOtel  = new DiveOtelProvider();       // spans on wrapped calls
const asyncFlow = new AsyncFlowProvider();      // ALS attribution backbone

attachHooks(defaultTypes);        // mnemonica lifecycle → dive edges
otel.attachHooks(defaultTypes);   // mnemonica lifecycle → OTel spans
diveOtel.attach();                // dive edges → OTel spans
asyncFlow.attach();               // unwrapped async hops → parental edge
```

- `attachHooks` is what makes every mnemonica construction a dive
  context automatically: creation edges, wrapped instance methods, and
  context-carrying constructor args. Without it, only your explicit
  `wrap()` calls are traced.
- Attaching twice doubles every span and every frame push — guard the
  startup path.
- `dive.clear()` is a test-only reset and it also detaches every
  provider: in your test setup, re-attach after each `clear()`. App code
  never calls it.
- Each provider accepts your own `Tracer`
  (`new DiveOtelProvider(myTracer)`); by default they share
  `trace.getTracer('@mnemonica/otel')`.

## Choosing what to attach

- `MnemonicaOtelProvider` — you want spans for data constructions
  (`mnemonica.<TypeName>`), parented by prototype lineage. Usually yes.
- `DiveOtelProvider` — you want spans for **every** dive-wrapped call,
  parented on dive's own trace; async spans close at settle, so durations
  are real. The noise/forensics trade-off: this is the verbose layer.
- `AsyncFlowProvider` — you want unwrapped async hops (timers, promise
  continuations, generator suspensions) attributed to the parental dive
  edge. Needs an ALS context to work from: the request scope or an
  explicit `runInScope`.
- `runInRequestScope(req, res, { tracer, otel, asyncFlow }, fn)` — one
  OTel span per HTTP request plus the triple async scope; call it at your
  framework's request boundary.
- `feedPreRootFromRequest(req)` — the thunderstruck boundary: feeds the
  request payloads (body/query/params/headers) into the pre-root store,
  correlated by object identity.

## Reading results in a crash handler

The reason the stack exists: when something fails, the error already
carries its story.

```typescript
import { buildUnblindReport, recordUnblindTelemetry } from '@mnemonica/otel';

const report = buildUnblindReport(error);   // dive branch + errored type + args
recordUnblindTelemetry(report, error);      // span + [unblind] stdout line
```

- `report.kind` (`'caught-unblinded'`), the span name
  (`'mnemonica.caught-exception'`) and the `[unblind]` stdout marker are
  pinned downstream — keep them stable.
- Dive-side reads work too: `getFlow(error)` (the branch) and
  `getErrorInstance(error)` (the data) come from `@mnemonica/dive`
  directly — see dive's docs.
- Extract synchronously inside the handler; payloads are only guaranteed
  alive until it returns.

## Framework notes

- **Express / Fastify / raw `http`**: the README recipes — middleware or
  `onRequest` hook calling `feedPreRootFromRequest` then
  `runInRequestScope` — are all you need.
- **NestJS**: it has its own dedicated package built over otel —
  `@mnemonica/nestjs` (interceptor-level request boundary, DI-scoped
  context, `attachHooks` at module init). Use it; do NOT wire otel by
  hand under NestJS.
- **Any framework with its own DI/pipes/interceptors/decorators**: same
  pattern — a first-party adapter package in the `@mnemonica` org; the
  hand-rolled recipes below are for simple frameworks only.
- **Queues / CLI / tests**: no request boundary — open an explicit scope
  per job with `asyncFlow.runInScope(() => consume(message))`.

## Version notes

- `mnemonica`, `@mnemonica/dive`, and `@opentelemetry/api` are peer
  dependencies — the app must own exactly one copy of each (process
  singletons).
- The supported dive range is `^0.7.0 || ^0.8.0 || ^0.9.0 || ^0.10.0`;
  with dive ≥ 0.9.0 the CJS `require()` chain is plain CJS end-to-end,
  older dives load through `require(esm)` (Node ≥ 20.19 / 22).
