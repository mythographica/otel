/**
 * Error-analysis crash-boundary fixture — spawned by error-analysis.spec.ts.
 *
 * Vitest intercepts uncaught errors, so the REAL handlers (uncaughtException /
 * unhandledRejection) only run truthfully in a plain node child (the same
 * rule dive's own suite follows). ONE JSON line on stdout per case; the
 * spec parses and asserts it. Run: node error-analysis-child.mjs <case>
 *
 * All imports are ESM on purpose: otel's ESM build, dive and mnemonica must
 * resolve to ONE dive instance each (the CJS/ESM flavors are separate
 * singletons — mixing them would read an empty trace).
 *
 * Cases:
 *  - timer            (b) evidence: timer throw inside runInEntryScope+asyncFlow
 *  - rejection        (b) evidence: floating rejection inside runInEntryScope+asyncFlow
 *  - last-context     (c) guess: top-level construction, then a jump-over
 *                     throw with no scope — current() is the residue
 *
 * NOTE on the "collected edge" scenario (source (b) falling through because
 * the frame's edge resolved to nothing): NOT PROBE-REACHABLE on the current
 * dive — emitEnter hands the LIVE edge in the payload (src/index.ts:295),
 * and the ALS-propagated timer retains the frame (and thus the edge) until
 * the callback fires — that retention IS what makes source (b) evidence
 * possible at crash time. Measured: three gc rounds cannot collect the
 * scheduler edge (see the room report). The defensive fall-through stays in
 * analyseError for the day dive hands copies instead.
 */
import * as dive from '@mnemonica/dive';
import { createTypesCollection } from 'mnemonica/module';
import { trace } from '@opentelemetry/api';
import {
	attachHooks,
	AsyncFlowProvider,
	MnemonicaOtelProvider,
	runInEntryScope,
	captureError,
	analyseError,
} from '../../build/index.js';

const emit = (value) => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};

const analyseShape = (analysis) => {
	const shape = {
		source             : analysis.source,
		evidence           : analysis.evidence,
		edgeNames          : analysis.edges.map((edge) => `${edge.kind}:${edge.name}`),
		edgesTruncated     : analysis.edgesTruncated,
		hasLineage         : analysis.lineage !== null,
		instances          : analysis.instances,
		instancesSkipped   : analysis.instancesSkipped,
		instancesTruncated : analysis.instancesTruncated,
		message            : analysis.message,
	};
	if (analysis.failedConstruction !== undefined) {
		shape.failedType = analysis.failedConstruction.typeName;
	}
	return shape;
};

const caseName = process.argv[2];
const tracer = trace.getTracer('fixture');
const otel = new MnemonicaOtelProvider(undefined);

if (caseName === 'timer' || caseName === 'rejection') {
	const flow = new AsyncFlowProvider();
	flow.attach();
	const collection = createTypesCollection({ name: 'ea-fixture' });
	attachHooks(collection);
	const Root = collection.define('Root', function (id) {
		this.id = id;
	});
	const root = new Root('r1');

	const handler = (error) => {
		const capture = captureError(error, { asyncFlow: flow });
		const analysis = analyseError(capture);
		emit(analyseShape(analysis));
		process.exit(0);
	};

	if (caseName === 'timer') {
		process.once('uncaughtException', handler);
		runInEntryScope(
			{ name: 'fixture timer' },
			{ tracer, otel, asyncFlow: flow },
			() => {
				dive.wrap(function schedulerTimer () {
					setTimeout(function laterCallback () {
						throw new Error('fixture: timer boom');
					}, 10);
				}, root)();
			},
		);
	} else {
		process.once('unhandledRejection', handler);
		runInEntryScope(
			{ name: 'fixture rejection' },
			{ tracer, otel, asyncFlow: flow },
			() => {
				dive.wrap(function fireAndForget () {
					new Promise((_, reject) => setTimeout(() => reject(new Error('fixture: floating boom')), 10));
				}, root)();
			},
		);
	}
} else if (caseName === 'last-context') {
	const collection = createTypesCollection({ name: 'ea-fixture' });
	attachHooks(collection);
	const Root = collection.define('Root', function (id) {
		this.id = id;
	});
	new Root('residue');
	// NO scope here: the timer callback is a genuine jump-over
	process.once('uncaughtException', (error) => {
		const analysis = analyseError(captureError(error));
		emit(analyseShape(analysis));
		process.exit(0);
	});
	dive.wrap(function schedulerResidue () {
		setTimeout(function laterResidue () {
			throw new Error('fixture: residue boom');
		}, 10);
	})();
} else {
	emit({ error: `unknown case: ${caseName}` });
	process.exit(1);
}
