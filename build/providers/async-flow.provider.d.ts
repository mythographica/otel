import type { FlowEdge } from '@mnemonica/dive';
export type FlowFrame = {
    /** the dive edge this frame belongs to (null on the root frame) */
    edgeId: number | null;
    /**
     * the edge object from the enter payload — dive hands the LIVE edge, so
     * the frame keeps it (and, through dive's parent links, its ancestors)
     * alive as long as the scope's async work lives. That retention is what
     * makes crash-time frame attribution evidence, the same way a pending
     * timer keeps its branch.
     */
    edge?: FlowEdge;
    /** the frame active when this one was entered */
    parent: FlowFrame | null;
    /** strong pins of context instances — ONE set per scope, shared down
     *  the chain by reference; dies with the scope's async executions */
    pinSet: Set<object>;
};
/** Read-only crash-time view of the active frame. */
export type CrashContext = {
    edgeId: number | null;
    /** the entering edge (the LIVE edge — strongly held by the frame, so
     *  alive whenever the frame is), when the frame belongs to an edge */
    edge?: FlowEdge;
    instances: object[];
};
export declare class AsyncFlowProvider {
    private frames;
    private detachers;
    /**
     * Subscribe to dive's edge lifecycle. Idempotent: attaching twice would
     * double every frame push. Dive's clear() wipes subscribers — re-attach
     * after it.
     */
    attach(): void;
    detach(): void;
    /**
     * Establish a root frame for non-HTTP scopes (queue consumers, CLI,
     * tests). The middleware is the HTTP root.
     */
    runInScope<T>(fn: () => T): T;
    /**
     * The frame active RIGHT NOW — in an uncaughtException handler this is
     * the failing execution's frame: the parental edge id plus every
     * context instance pinned by the scope. Undefined outside any scope.
     */
    currentFrame(): CrashContext | undefined;
    private onEnter;
    private onLeave;
    private onCreate;
}
//# sourceMappingURL=async-flow.provider.d.ts.map