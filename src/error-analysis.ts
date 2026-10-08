/**
 * Error analysis — error → its dive edge → its instances.
 *
 * On uncaughtException /
 * unhandledRejection there is an error to analyse; this module finds
 * WHICH dive edge it came from, walks that edge's chain, and collects the
 * instances wired to it — returning DATA, never printing anything (the
 * caller decides what to log; nothing here writes to stdout or console).
 *
 * Two phases, because after uncaughtException the pod may be killed and
 * deferred work may never run:
 *
 * - captureError(error, deps?) — PHASE 1, synchronous and cheap: keeps
 *   REFERENCES only (the error, the async-flow frame's edge and
 *   pinned instances when a provider is given, dive.current()). No stack
 *   reading, no graphs.
 * - analyseError(capture, budget?) — PHASE 2, only when the caller asks:
 *   picks the edge chain from the FIRST source that has one —
 *     (a) getFlow(error)              — the error was pinned by dive's own
 *                                       wrapper: EVIDENCE;
 *     (b) getFlow(frame.edge)         — the ALS frame at crash time: also
 *                                       EVIDENCE on Node. Dive hands the
 *                                       LIVE edge in the enter payload, and
 *                                       the frame keeps it (plus, through
 *                                       dive's parent links, its ancestors)
 *                                       alive as long as the scope's async
 *                                       work lives — the same way a pending
 *                                       timer keeps its branch. The edge
 *                                       cannot be "already collected" while
 *                                       the frame exists;
 *     (c) getFlow(capture.current)    — dive's rest residue: a labelled
 *                                       GUESS, never evidence;
 *     (d) none                        — source 'none'.
 *   One core utils.lineage graph is built over the DISTINCT LIVE instances
 *   of the chain (collected instances are skipped and counted). Budget {
 *   maxEdges, maxInstances } bounds the work; every truncation is reported
 *   in the result, never silent.
 *
 * - recordErrorAnalysis(analysis, span) puts the result on a span THE
 *   CALLER PASSES: one 'mnemonica.error' event with the lineage graph JSON
 *   in 'mnemonica.lineage.graph' plus the source and the evidence flag.
 */
import { getFlow, current } from '@mnemonica/dive';
import type { FlowEdge } from '@mnemonica/dive';
import { utils, getProps } from 'mnemonica/module';
import type { Span } from '@opentelemetry/api';
import type { AsyncFlowProvider } from './providers/async-flow.provider.js';

/** core does not re-export the LineageGraph name from its entry d.ts —
 *  the graph type is exactly what utils.lineage returns */
type LineageGraph = ReturnType<typeof utils.lineage>;

/** the span event and attribute names — the cross-language contract */
const EVENT_ERROR = 'mnemonica.error';
const ATTR_LINEAGE_GRAPH = 'mnemonica.lineage.graph';
const ATTR_SOURCE = 'mnemonica.error.source';
const ATTR_EVIDENCE = 'mnemonica.error.evidence';

export type ErrorSource = 'error' | 'async-frame' | 'last-context' | 'none';

export interface ErrorAnalysisDeps {
	asyncFlow?: AsyncFlowProvider;
}

export interface AnalysisBudget {
	/** chain length cap; the failure-proximal TAIL is kept */
	maxEdges?     : number;
	/** distinct live instances fed into the lineage graph */
	maxInstances? : number;
}

const DEFAULT_MAX_EDGES = 32;
const DEFAULT_MAX_INSTANCES = 16;

export interface AnalysedEdge {
	kind     : string;
	name     : string;
	status   : string;
	callsite?: string;
}

export interface ErrorAnalysis {
	source               : ErrorSource;
	evidence             : boolean;
	message              : string;
	edges                : AnalysedEdge[];
	/** chain edges cut by maxEdges (the failure-proximal tail was kept) */
	edgesTruncated       : number;
	/** the error itself IS a failed mnemonica construction */
	failedConstruction?  : {
		typeName     : string;
		attemptedArgs: unknown;
	};
	/** ONE core utils.lineage graph over the chain's distinct live
	 *  instances; null when the chain carried none */
	lineage              : LineageGraph | null;
	instances            : number;
	/** chain edges whose instance was already collected — skipped, counted */
	instancesSkipped     : number;
	/** live instances cut by maxInstances (never entered the graph) */
	instancesTruncated   : number;
}

/**
 * PHASE 1 — synchronous capture of REFERENCES only. Safe inside an
 * uncaughtException handler: no stack reading, no graph building.
 */
export interface ErrorCapture {
	error          : unknown;
	/** the ALS frame's edge (the LIVE edge dive hands in the enter payload),
	 *  when a provider was given at capture — the frame keeps it alive */
	frameEdge?     : FlowEdge;
	/** the frame's pinned context instances (strong refs, request-lifetime) */
	frameInstances : object[];
	/** dive.current() at capture time — the rest residue */
	current        : object | null;
}

export function captureError (error: unknown, deps?: ErrorAnalysisDeps): ErrorCapture {
	const frame = deps?.asyncFlow?.currentFrame();
	const capture: ErrorCapture = {
		error,
		frameInstances : frame?.instances ?? [],
		current        : current() ?? null,
	};
	if (frame?.edge !== undefined) {
		capture.frameEdge = frame.edge;
	}
	return capture;
}

// the attempted constructor args of a FAILED mnemonica construction ride
// the errored shell itself: getProps exposes { args, originalError, … } off
// the props WeakMap. Degrades to undefined — never throws on this path.
const erroredArgsSafe = (error: Error): unknown => {
	try {
		const props = getProps(error) as { args?: unknown } | undefined;
		const result = props?.args;
		return result;
	} catch {
		const result = undefined;
		return result;
	}
};

const isFailedConstruction = (error: unknown): error is Error => {
	const failedCheck = error instanceof Error && getProps(error) !== undefined;
	return failedCheck;
};

export function analyseError (
	capture  : ErrorCapture,
	budget   : AnalysisBudget = {},
): ErrorAnalysis {
	const maxEdges = budget.maxEdges ?? DEFAULT_MAX_EDGES;
	const maxInstances = budget.maxInstances ?? DEFAULT_MAX_INSTANCES;
	const message = capture.error instanceof Error
		? capture.error.message
		: String(capture.error);

	// --- pick the chain from the FIRST source that has one
	let source: ErrorSource = 'none';
	let evidence = false;
	let chain: FlowEdge[] = [];

	if (capture.error instanceof Error) {
		const fromError = getFlow(capture.error);
		if (fromError.length > 0) {
			source = 'error';
			evidence = true;
			chain = fromError;
		}
	}
	if (source === 'none' && capture.frameEdge !== undefined) {
		// the frame holds the LIVE edge (dive's enter payload), alive as
		// long as the frame — getFlow cannot come back empty here
		const fromFrame = getFlow(capture.frameEdge);
		if (fromFrame.length > 0) {
			source = 'async-frame';
			evidence = true;
			chain = fromFrame;
		}
	}
	if (source === 'none' && capture.current !== null) {
		const fromCurrent = getFlow(capture.current);
		if (fromCurrent.length > 0) {
			source = 'last-context';
			evidence = false;
			chain = fromCurrent;
		}
	}

	// --- budget the chain: the failure-proximal TAIL is kept
	const edgesTruncated = Math.max(0, chain.length - maxEdges);
	const keptEdges = chain.slice(-maxEdges);
	const edges: AnalysedEdge[] = keptEdges.map((edge) => {
		const analysed: AnalysedEdge = {
			kind   : edge.kind,
			name   : edge.name,
			status : edge.status,
		};
		if (edge.callsite !== undefined) {
			analysed.callsite = edge.callsite;
		}
		return analysed;
	});

	// --- the error itself IS a failed mnemonica construction
	let failedConstruction: ErrorAnalysis['failedConstruction'];
	if (isFailedConstruction(capture.error)) {
		const props = getProps(capture.error) as {
			__type__?: { TypeName?: string };
		} | undefined;
		const typeName = props?.__type__?.TypeName ?? capture.error.constructor.name;
		failedConstruction = {
			typeName,
			attemptedArgs : erroredArgsSafe(capture.error),
		};
	}

	// --- ONE lineage graph over the DISTINCT LIVE instances of the chain
	const seen = new Set<object>();
	const liveInstances: object[] = [];
	let instancesSkipped = 0;
	for (const edge of keptEdges) {
		const instance = edge.instance;
		if (instance === undefined) {
			// count only instances that WERE there and got collected;
			// edges recorded without an instance are not skipped data
			if (edge.instanceCollected === true) {
				instancesSkipped += 1;
			}
			continue;
		}
		if (seen.has(instance)) {
			continue;
		}
		seen.add(instance);
		liveInstances.push(instance);
	}
	const instancesTruncated = Math.max(0, liveInstances.length - maxInstances);
	const keptInstances = liveInstances.slice(0, maxInstances);
	const lineage: LineageGraph | null = keptInstances.length > 0
		? utils.lineage(keptInstances)
		: null;

	const analysis: ErrorAnalysis = {
		source,
		evidence,
		message,
		edges,
		edgesTruncated,
		lineage,
		instances            : keptInstances.length,
		instancesSkipped,
		instancesTruncated,
	};
	if (failedConstruction !== undefined) {
		analysis.failedConstruction = failedConstruction;
	}
	return analysis;
}

/**
 * Put the analysis on a span THE CALLER PASSES — one 'mnemonica.error'
 * event: the lineage graph JSON in 'mnemonica.lineage.graph', plus the
 * source and the evidence flag. No span is created here; no stdout.
 */
export function recordErrorAnalysis (analysis: ErrorAnalysis, span: Span): void {
	const attributes: Record<string, string | boolean> = {
		[ATTR_SOURCE]   : analysis.source,
		[ATTR_EVIDENCE] : analysis.evidence,
	};
	if (analysis.lineage !== null) {
		attributes[ATTR_LINEAGE_GRAPH] = JSON.stringify(analysis.lineage);
	}
	span.addEvent(EVENT_ERROR, attributes);
}
