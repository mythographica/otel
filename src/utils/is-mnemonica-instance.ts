/**
 * Runtime type guard for mnemonica instances.
 * Uses mnemonica's getProps() — no instanceof hacks, works across realms.
 */
import { getProps } from 'mnemonica/module';

export function isMnemonicaInstance (value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && getProps(value) !== undefined;
}
