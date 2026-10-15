/**
 * End-to-end pins for the lineage link (src/lineage-link.ts).
 *
 * The contract in one flow, SDK in-memory exporter only:
 * a request span → stamped constructions (ids equal core utils.lineage's
 * lazy ids) → work after the request on a LINKED span → a plain span when
 * nothing was recorded. The error-path half of the contract (the
 * 'mnemonica.error' event with the lethe-format graph) lives in
 * error-analysis.ts and is pinned in error-analysis.spec.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { trace, context as otelContext } from '@opentelemetry/api';
import {
	createTypesCollection,
	utils,
	type TypesCollection,
} from 'mnemonica/module';
import {
	stampConstructions,
	startLinkedSpan,
	ATTR_INSTANCE_ID,
	ATTR_PARENT_ID,
	ATTR_TYPE_COLLECTION,
	ATTR_TYPE_PATH,
} from '../src/lineage-link.js';

interface UserShape {
	name: string;
	Admin: new (role: string) => AdminShape;
}
interface AdminShape {
	name: string;
	role: string;
}

describe('lineage link', () => {
	// ONE global provider per file: register() is a no-op after the first
	// call, so per-test providers would orphan the exporter — the same
	// pattern as the other OTel specs.
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider();
	provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
	provider.register();

	beforeEach(() => {
		exporter.reset();
	});

	it('stamps the contract attributes on the span current at construction', async () => {
		const tracer = provider.getTracer('test');
		const collection: TypesCollection = createTypesCollection({ name : 'otel-test' });
		stampConstructions(collection);

		const User = collection.define('User', function (this: UserShape, name: string) {
			this.name = name;
		});
		User.define('Admin', function (this: AdminShape, role: string) {
			this.role = role;
		});

		const requestSpan = tracer.startSpan('request');
		let user!: UserShape;
		let admin!: AdminShape;
		otelContext.with(trace.setSpan(otelContext.active(), requestSpan), () => {
			user = new User('ada');
			admin = new user.Admin('root');
		});
		requestSpan.end();
		await provider.forceFlush();

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(1);
		const [ stamped ] = spans;
		expect(stamped.name).toBe('request');

		// the LAST construction wins on a shared span: the subtype's values
		const userId = utils.lineage([ user ]).heads[ 0 ] as string;
		const adminId = utils.lineage([ admin ]).heads[ 0 ] as string;
		expect(stamped.attributes[ ATTR_INSTANCE_ID ]).toBe(adminId);
		expect(stamped.attributes[ ATTR_PARENT_ID ]).toBe(userId);
		expect(stamped.attributes[ ATTR_TYPE_COLLECTION ]).toBe('otel-test');
		expect(stamped.attributes[ ATTR_TYPE_PATH ]).toBe('User.Admin');

		// ids on the stamped attributes ARE core's lazy ids
		expect(adminId).not.toBe(userId);
	});

	it('stamps nothing when no span is current at construction', () => {
		const collection: TypesCollection = createTypesCollection({ name : 'otel-nospan' });
		stampConstructions(collection);
		const User = collection.define('User', function (this: UserShape, name: string) {
			this.name = name;
		});
		// no active span: the hook must be a cheap no-op, never a throw
		const user = new User('ada');
		expect(user.name).toBe('ada');
	});

	it('links post-request work to the construction span', async () => {
		const tracer = provider.getTracer('test');
		const collection: TypesCollection = createTypesCollection({ name : 'otel-link' });
		stampConstructions(collection);

		const User = collection.define('User', function (this: UserShape, name: string) {
			this.name = name;
		});

		const requestSpan = tracer.startSpan('request');
		let user!: UserShape;
		otelContext.with(trace.setSpan(otelContext.active(), requestSpan), () => {
			user = new User('ada');
		});
		requestSpan.end();

		// the request is over — work after it still joins the trace via Link
		const linked = startLinkedSpan(tracer, 'post-request work', user);
		linked.end();
		await provider.forceFlush();

		const linkedSpan = exporter.getFinishedSpans().find((s) => s.name === 'post-request work');
		expect(linkedSpan).toBeDefined();
		expect(linkedSpan!.links.length).toBe(1);
		expect(linkedSpan!.links[ 0 ].context.spanId).toBe(requestSpan.spanContext().spanId);
		expect(linkedSpan!.links[ 0 ].context.traceId).toBe(requestSpan.spanContext().traceId);
	});

	it('starts a plain span when the instance carries no recorded context', () => {
		const tracer = provider.getTracer('test');
		const collection: TypesCollection = createTypesCollection({ name : 'otel-plain' });
		const User = collection.define('User', function (this: UserShape, name: string) {
			this.name = name;
		});
		// no stampConstructions, no span at construction: plain span
		const user = new User('ada');
		const plain = startLinkedSpan(tracer, 'plain work', user);
		expect(trace.isSpanContextValid(plain.spanContext())).toBe(true);
		plain.end();
	});
});
