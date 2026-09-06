import type { Tracer, Span } from '@opentelemetry/api';
import type { TypesCollection } from 'mnemonica/module';
export declare class MnemonicaOtelProvider {
    private tracer;
    private pendingSpans;
    constructor(tracer?: Tracer);
    getCurrentSpan(): Span | undefined;
    runWithSpan<T>(span: Span, fn: () => T): T;
    attachHooks(collection: TypesCollection): void;
    private findParentSpan;
}
//# sourceMappingURL=mnemonica-otel.provider.d.ts.map