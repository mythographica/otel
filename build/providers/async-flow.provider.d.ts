export type FlowFrame = {
    /** the dive edge this frame belongs to (null on the root frame) */
    edgeId: number | null;
    /** the frame active when this one was entered */
    parent: FlowFrame | null;
    /** strong pins of context instances — ONE set per scope, shared down
     *  the chain by reference; dies with the scope's async executions */
    pinSet: Set<object>;
};
/** Read-only crash-time view of the active frame. */
export type CrashContext = {
    edgeId: number | null;
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